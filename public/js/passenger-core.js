const socket = io();
let passengerMap = null;
let passengerMarker = null;
let busMarker = null;
let currentRouteStops = [];
let selectedRouteId = null;
let isAlertActive = false;

// ==========================================
// التحميل الأولي: جلب المسارات النشطة (مع دعم التصنيف الذكي)
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        // محاولة جلب المسارات والحافلات النشطة والمصنفة
        const res = await fetch('/api/passenger/routes?audience=all');
        const routes = await res.json();
        
        const selector = document.getElementById('routeSelector');
        if (selector) {
            selector.innerHTML = '<option value="" disabled selected>-- اختر المسار والرحلة المتاحة --</option>' + 
                routes.map(r => {
                    const rId = r.route_id || r.id;
                    const rName = r.route_name || r.name;
                    const busPlateStr = r.bus_plate ? ` (باص: ${r.bus_plate})` : '';
                    return `<option value="${rId}">${rName}${busPlateStr}</option>`;
                }).join('');
        }
    } catch (err) {
        console.error("تعذر جلب المسارات المصنفة، جاري محاولة الجلب البديل...", err);
        // آلية احتياطية (Fallback) لجلب المسارات العادية لضمان عدم توقف الواجهة
        try {
            const resFallback = await fetch('/api/routes');
            const routesFallback = await resFallback.json();
            const selector = document.getElementById('routeSelector');
            if (selector) {
                selector.innerHTML = '<option value="" disabled selected>-- اختر المسار --</option>' + 
                    routesFallback.map(r => `<option value="${r.id}">${r.route_name}</option>`).join('');
            }
        } catch (e) {
            console.error("خطأ نهائي في جلب المسارات", e);
        }
    }
});

// ==========================================
// بدء تتبع المسار المختار
// ==========================================
function trackSelectedRoute() {
    const routeSelector = document.getElementById('routeSelector');
    if (!routeSelector) return;
    
    selectedRouteId = routeSelector.value;
    if (!selectedRouteId) return;

    const mapEl = document.getElementById('passengerMap');
    const scheduleEl = document.getElementById('stopsScheduleContainer');
    const infoCardEl = document.getElementById('infoCard');

    if (mapEl) mapEl.style.display = 'block';
    if (scheduleEl) scheduleEl.style.display = 'block';
    if (infoCardEl) infoCardEl.innerText = '🔍 جاري تحديد موقعك ومحطات الخط...';

    initPassengerMap();
    loadRouteStopsForPassenger(selectedRouteId);
}

// ==========================================
// تهيئة خريطة الراكب ومتابعة موقع GPS الخاص به
// ==========================================
function initPassengerMap() {
    if (!passengerMap) {
        passengerMap = L.map('passengerMap').setView([31.95, 35.91], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(passengerMap);
    } else {
        passengerMap.invalidateSize();
    }

    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            if (!passengerMarker) {
                passengerMarker = L.marker([lat, lng], {
                    icon: L.divIcon({ className: 'passenger-icon', html: '🧍‍♂️', iconSize: [25, 25] })
                }).addTo(passengerMap).bindPopup('أنت هنا');
            } else {
                passengerMarker.setLatLng([lat, lng]);
            }

            checkProximityToStops(lat, lng);
        }, err => console.log(err), { enableHighAccuracy: true });
    }
}

// ==========================================
// جلب محطات المسار وعرضها للراكب
// ==========================================
async function loadRouteStopsForPassenger(routeId) {
    try {
        const res = await fetch(`/api/stops/${routeId}`);
        currentRouteStops = await res.json();

        const scheduleContainer = document.getElementById('stopsScheduleContainer');
        if (!scheduleContainer) return;
        
        scheduleContainer.innerHTML = '';

        currentRouteStops.forEach((stop) => {
            L.marker([stop.latitude, stop.longitude], {
                icon: L.divIcon({ className: 'stop-icon', html: '🚏', iconSize: [20, 20] })
            }).addTo(passengerMap).bindPopup(`<b>${stop.stop_name}</b><br>وقت الانتظار: ${stop.dwell_time_minutes}د`);

            scheduleContainer.innerHTML += `
                <div class="stop-item" id="stop-row-${stop.id}">
                    <span><b>[${stop.stop_order}]</b> ${stop.stop_name}</span>
                    <span style="color: #007bff;">⏳ ${stop.dwell_time_minutes} دقيقة</span>
                </div>
            `;
        });

        const infoCardEl = document.getElementById('infoCard');
        if (currentRouteStops.length > 0) {
            passengerMap.setView([currentRouteStops[0].latitude, currentRouteStops[0].longitude], 14);
            if (infoCardEl) infoCardEl.innerText = '🟢 النظام نشط - يتم تتبع موقع الحافلة الآن';
        }
    } catch (err) {
        console.error("خطأ في جلب المحطات", err);
    }
}

// ==========================================
// فحص اقتراب الراكب من المحطات (ضمن نطاق 100 متر)
// ==========================================
function checkProximityToStops(passengerLat, passengerLng) {
    let nearStationBox = document.getElementById('stationAlertBox');
    let nearestStationText = document.getElementById('nearestStationText');
    let foundNear = false;

    currentRouteStops.forEach(stop => {
        let distance = getDistanceFromLatLonInMeters(passengerLat, passengerLng, stop.latitude, stop.longitude);
        if (distance <= 100) { 
            foundNear = true;
            if (nearestStationText) {
                nearestStationText.innerText = `📍 أنت قريب جداً من محطة: "${stop.stop_name}" (${Math.round(distance)} متر)`;
            }
        }
    });

    if (nearStationBox) {
        if (foundNear) {
            nearStationBox.style.display = 'block';
        } else if (!isAlertActive) {
            nearStationBox.style.display = 'none';
        }
    }
}

// ==========================================
// دوال حساب المسافات الجغرافية
// ==========================================
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// ==========================================
// نظام تنبيه السائق من الراكب
// ==========================================
function togglePassengerAlert() {
    const btn = document.getElementById('alertDriverBtn');
    isAlertActive = !isAlertActive;

    if (isAlertActive) {
        if (btn) {
            btn.classList.add('active');
            btn.innerText = '⚠️ تم إرسال التنبيه للسائق (اضغط للإلغاء)';
        }
        socket.emit('passengerAlert', { routeId: selectedRouteId, message: 'تنبيه: يوجد راكب ينتظر في المحطة!' });
    } else {
        if (btn) {
            btn.classList.remove('active');
            btn.innerText = '🚨 تنبيه السائق بوجود راكب في المحطة';
        }
        socket.emit('passengerCancelAlert', { routeId: selectedRouteId });
    }
}

// ==========================================
// استقبال موقع الحافلة اللحظي عبر الـ WebSockets ورسمه
// ==========================================
socket.on('busLocationUpdate', (data) => {
    if (data.routeId == selectedRouteId) {
        if (!passengerMap) return;
        
        if (!busMarker) {
            busMarker = L.marker([data.lat, data.lng], {
                icon: L.divIcon({ className: 'bus-moving-icon', html: '🚍', iconSize: [32, 32] })
            }).addTo(passengerMap).bindPopup('الحافلة في طريقها إليك');
        } else {
            busMarker.setLatLng([data.lat, data.lng]);
        }
    }
});

// ==========================================
// دالة تسجيل الخروج للراكب
// ==========================================
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = '/login.html';
}