const socket = io();
let passengerMap = null;
let passengerMarker = null;
let busMarker = null;
let currentRouteStops = [];
let selectedRouteId = null;
let isAlertActive = false;

// ==========================================
// التحميل الأولي: جلب قائمة الرحلات وعرضها كبطاقات
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) { window.location.href = '/login.html'; return; }
    
    const currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'passenger' && currentUser.role !== 'admin') {
        alert("عذراً، هذه الشاشة مخصصة للركاب.");
        window.location.href = '/login.html'; return;
    }

    const nameDisplay = document.getElementById('passengerNameDisplay');
    if (nameDisplay) nameDisplay.innerText = currentUser.full_name;

    await loadAvailableTripsCards();
});

// دالة جلب وعرض رحلات الحافلات كبطاقات تفصيلية في واجهة الراكب
async function loadAvailableTripsCards() {
    try {
        const res = await fetch('/api/passenger/routes?audience=all');
        const trips = await res.json();
        
        const container = document.getElementById('availableTripsContainer');
        if (!container) return;

        if (trips.length === 0) {
            container.innerHTML = `<p style="text-align: center; color: #777; padding: 20px;">لا توجد رحلات أو حافلات متاحة حالياً.</p>`;
            return;
        }

        let html = '';
        trips.forEach(t => {
            const timeStr = t.scheduled_time ? new Date(t.scheduled_time).toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' }) : 'غير محدد';
            let badge = t.target_audience === 'student' ? '🎓 للطلاب' : t.target_audience === 'employee' ? '💼 للموظفين' : '🌐 للجميع';

            // معالجة حالات الرحلة وتوليد الشارة المناسبة
            let statusBadge = '';
            let statusText = t.status;
            
            if (statusText === 'pending') {
                statusBadge = '<span style="background: #ffc107; color: black; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">⏳ مجدولة</span>';
            } else if (statusText === 'active') {
                statusBadge = '<span style="background: #28a745; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">🟢 جارية الآن</span>';
            } else if (statusText === 'stopped') {
                statusBadge = '<span style="background: #17a2b8; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">⏸️ متوقفة مؤقتاً</span>';
            } else if (statusText === 'cancelled') {
                statusBadge = '<span style="background: #dc3545; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">❌ ملغاة</span>';
            } else if (statusText === 'postponed') {
                statusBadge = '<span style="background: #6c757d; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">⏰ مؤجلة</span>';
            } else if (statusText === 'delayed') {
                const delayMins = t.delay_minutes || 15; // قيمة افتراضية أو مستخرجة من قاعدة البيانات
                statusBadge = `<span style="background: #fd7e14; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">⚠️ متأخرة (${delayMins} دقيقة)</span>`;
            } else {
                statusBadge = `<span style="background: #343a40; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px;">${statusText}</span>`;
            }

            html += `
                <div class="trip-card" onclick="selectTripAndTrack(${t.route_id}, '${t.route_name}', '${t.bus_plate}', '${t.driver_name}')">
                    <div class="trip-title">${t.route_name} <span style="float: left;">${statusBadge}</span></div>
                    <div class="info-text" style="margin-top: 8px;">🚌 الحافلة: <strong>${t.bus_plate}</strong> | الفئة: ${badge}</div>
                    <div class="info-text">👨‍✈️ السائق: ${t.driver_name}</div>
                    <div class="info-text">🕒 موعد الانطلاق: <span style="color: #d9534f; font-weight: bold;">${timeStr}</span></div>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (err) {
        console.error("خطأ في جلب رحلات الراكب:", err);
    }
}

// اختيار رحلة والانتقال لخريطة التتبع والمحطات
function selectTripAndTrack(routeId, routeName, busPlate, driverName) {
    selectedRouteId = routeId;

    // تبديل العرض بين القائمة وشاشة التتبع
    document.getElementById('tripsListSection').style.display = 'none';
    document.getElementById('trackingSection').style.display = 'block';
    document.getElementById('passengerMap').style.display = 'block';
    document.getElementById('stopsScheduleContainer').style.display = 'block';
    document.getElementById('infoCard').style.display = 'block';
    document.getElementById('infoCard').innerText = `🔍 جاري تحميل محطات مسار (${routeName}) وتتبع الحافلة (${busPlate})...`;

    initPassengerMap();
    loadRouteStopsForPassenger(routeId);
}

// العودة لقائمة الرحلات
function backToTripsList() {
    selectedRouteId = null;
    document.getElementById('trackingSection').style.display = 'none';
    document.getElementById('tripsListSection').style.display = 'block';
    
    if (busMarker && passengerMap) {
        passengerMap.removeLayer(busMarker);
        busMarker = null;
    }
    loadAvailableTripsCards();
}

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

async function loadRouteStopsForPassenger(routeId) {
    try {
        const res = await fetch(`/api/stops/${routeId}`);
        currentRouteStops = await res.json();

        const scheduleContainer = document.getElementById('stopsScheduleContainer');
        if (!scheduleContainer) return;
        
        scheduleContainer.innerHTML = '<h4 style="margin: 0 0 10px 0; font-size: 14px; color: #333;">🚏 محطات خط السير:</h4>';

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
            if (infoCardEl) infoCardEl.innerText = '🟢 النظام نشط - يتم تتبع موقع الحافلة لحظياً الآن';
        }
    } catch (err) {
        console.error("خطأ في جلب المحطات", err);
    }
}

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

function togglePassengerAlert() {
    const btn = document.getElementById('alertDriverBtn');
    isAlertActive = !isAlertActive;

    if (isAlertActive) {
        if (btn) {
            btn.classList.add('active');
            btn.innerText = '⚠️ تم إرسال التنبيه للسائق (اضغط للإلغاء)';
            btn.style.background = '#dc3545';
        }
        socket.emit('passengerAlert', { routeId: selectedRouteId, message: 'تنبيه: يوجد راكب ينتظر في المحطة!' });
    } else {
        if (btn) {
            btn.classList.remove('active');
            btn.innerText = '🚨 تنبيه السائق بوجود راكب في المحطة';
            btn.style.background = '#fd7e14';
        }
        socket.emit('passengerCancelAlert', { routeId: selectedRouteId });
    }
}

function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = '/login.html';
}

// استقبال موقع الحافلة اللحظي ورسمه على خريطة الراكب
socket.on('busLocationUpdate', (data) => {
    if (selectedRouteId && data.routeId == selectedRouteId) {
        if (!passengerMap) return;
        
        if (!busMarker) {
            busMarker = L.marker([data.lat, data.lng], {
                icon: L.divIcon({ className: 'bus-moving-icon', html: '🚍', iconSize: [32, 32] })
            }).addTo(passengerMap).bindPopup('الحافلة تتحرك نحو محطتك');
        } else {
            busMarker.setLatLng([data.lat, data.lng]);
        }
    }
});