const socket = io();
let passengerMap = null;
let passengerMarker = null;
let busMarker = null;
let currentRouteStops = [];
let selectedRouteId = null;
let isAlertActive = false;

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/routes');
        const routes = await res.json();
        
        document.getElementById('routeSelector').innerHTML = '<option value="" disabled selected>-- اختر المسار --</option>' + 
            routes.map(r => `<option value="${r.id}">${r.route_name}</option>`).join('');
    } catch (err) {
        console.error("خطأ في جلب المسارات", err);
    }
});

function trackSelectedRoute() {
    selectedRouteId = document.getElementById('routeSelector').value;
    if (!selectedRouteId) return;

    document.getElementById('passengerMap').style.display = 'block';
    document.getElementById('stopsScheduleContainer').style.display = 'block';
    document.getElementById('infoCard').innerText = '🔍 جاري تحديد موقعك ومحطات الخط...';

    initPassengerMap();
    loadRouteStopsForPassenger(selectedRouteId);
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

        if (currentRouteStops.length > 0) {
            passengerMap.setView([currentRouteStops[0].latitude, currentRouteStops[0].longitude], 14);
            document.getElementById('infoCard').innerText = '🟢 النظام نشط - يتم تتبع موقع الحافلة الآن';
        }
    } catch (err) {
        console.error("خطأ في جلب المحطات", err);
    }
}

function checkProximityToStops(passengerLat, passengerLng) {
    let nearStationBox = document.getElementById('stationAlertBox');
    let foundNear = false;

    currentRouteStops.forEach(stop => {
        let distance = getDistanceFromLatLonInMeters(passengerLat, passengerLng, stop.latitude, stop.longitude);
        if (distance <= 100) { 
            foundNear = true;
            document.getElementById('nearestStationText').innerText = `📍 أنت قريب جداً من محطة: "${stop.stop_name}" (${Math.round(distance)} متر)`;
        }
    });

    if (foundNear) {
        nearStationBox.style.display = 'block';
    } else if (!isAlertActive) {
        nearStationBox.style.display = 'none';
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
        btn.classList.add('active');
        btn.innerText = '⚠️ تم إرسال التنبيه للسائق (اضغط للإلغاء)';
        socket.emit('passengerAlert', { routeId: selectedRouteId, message: 'تنبيه: يوجد راكب ينتظر في المحطة!' });
    } else {
        btn.classList.remove('active');
        btn.innerText = '🚨 تنبيه السائق بوجود راكب في المحطة';
        socket.emit('passengerCancelAlert', { routeId: selectedRouteId });
    }
}

// استقبال موقع الحافلة اللحظي ورسمه على خريطة الراكب
socket.on('busLocationUpdate', (data) => {
    if (data.routeId == selectedRouteId) {
        if (!busMarker) {
            busMarker = L.marker([data.lat, data.lng], {
                icon: L.divIcon({ className: 'bus-moving-icon', html: '🚍', iconSize: [32, 32] })
            }).addTo(passengerMap).bindPopup('الحافلة في طريقها إليك');
        } else {
            busMarker.setLatLng([data.lat, data.lng]);
        }
    }
});