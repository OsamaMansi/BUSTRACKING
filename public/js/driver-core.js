const socket = io();
let currentDriverId = null;
let driverMap = null;
let driverMarker = null;
let watchId = null;
let countdownInterval = null;

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/users');
        const users = await res.json();
        const drivers = users.filter(u => u.role === 'driver');
        
        document.getElementById('driverSelector').innerHTML = '<option value="" disabled selected>-- اختر اسمك --</option>' + 
            drivers.map(d => `<option value="${d.id}">${d.full_name}</option>`).join('');
    } catch (err) {
        console.error("خطأ في التحميل", err);
    }
});

async function loadDriverTrip() {
    currentDriverId = document.getElementById('driverSelector').value;
    if (!currentDriverId) return;

    try {
        const res = await fetch(`/api/trips/driver/${currentDriverId}`);
        const trip = await res.json();

        const tripCard = document.getElementById('tripCard');
        const noTripMsg = document.getElementById('noTripMessage');
        const btnStart = document.getElementById('btnStart');
        const btnComplete = document.getElementById('btnComplete');
        const btnArrived = document.getElementById('btnArrivedStop');
        const mapDiv = document.getElementById('driverMap');

        if (trip && trip.id) {
            noTripMsg.style.display = 'none';
            tripCard.style.display = 'block';
            mapDiv.style.display = 'block';

            document.getElementById('currentTripId').value = trip.id;
            document.getElementById('currentRouteId').value = trip.route_id;
            document.getElementById('lblRouteName').innerText = trip.route_name;
            document.getElementById('lblBusPlate').innerText = trip.bus_plate;

            initDriverMap(trip.route_id);

            if (trip.status === 'pending') {
                document.getElementById('lblStatus').innerText = 'مجدولة ⏳';
                btnStart.style.display = 'block';
                btnComplete.style.display = 'none';
                btnArrived.style.display = 'none';
            } else if (trip.status === 'active') {
                document.getElementById('lblStatus').innerText = 'جارية 🟢';
                btnStart.style.display = 'none';
                btnComplete.style.display = 'block';
                btnArrived.style.display = 'block';
            }
        } else {
            tripCard.style.display = 'none';
            noTripMsg.style.display = 'block';
            mapDiv.style.display = 'none';
            if (watchId) navigator.geolocation.clearWatch(watchId);
        }
    } catch (err) {
        console.error("خطأ في جلب الرحلة", err);
    }
}

// تهيئة خريطة السائق وتتبع الموقع وإرساله للركاب
async function initDriverMap(routeId) {
    if (!driverMap) {
        driverMap = L.map('driverMap').setView([31.95, 35.91], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(driverMap);
    } else {
        driverMap.invalidateSize();
    }

    try {
        const res = await fetch(`/api/stops/${routeId}`);
        const stops = await res.json();
        
        stops.forEach((stop) => {
            L.marker([stop.latitude, stop.longitude]).addTo(driverMap)
              .bindPopup(`<b>محطة [${stop.stop_order}]: ${stop.stop_name}</b><br>وقت الانتظار: ${stop.dwell_time_minutes}د`);
        });

        if (stops.length > 0) {
            driverMap.setView([stops[0].latitude, stops[0].longitude], 14);
        }
    } catch(err) { console.error(err); }

    // تتبع موقع السائق عبر GPS وإرساله للركاب لحظياً
    if (navigator.geolocation) {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        
        watchId = navigator.geolocation.watchPosition(position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            if (!driverMarker) {
                driverMarker = L.marker([lat, lng], {
                    icon: L.divIcon({ className: 'bus-icon', html: '🚌', iconSize: [30, 30] })
                }).addTo(driverMap).bindPopup('موقعك الحالي');
            } else {
                driverMarker.setLatLng([lat, lng]);
            }

            // [الإضافة الجديدة]: جعل الخريطة تتحرك وتتمركز حول السائق فور تغير موقعه
            driverMap.panTo([lat, lng]);

            // إرسال الإحداثيات للركاب عبر الـ Socket.io
            const currentRouteId = document.getElementById('currentRouteId').value;
            if (currentRouteId) {
                socket.emit('updateBusLocation', { routeId: currentRouteId, lat, lng, driverId: currentDriverId });
            }

        }, err => console.log(err), { enableHighAccuracy: true });
    }
}

// العداد التنازلي للمحطة
function startStationDwell(durationSeconds) {
    const timerBox = document.getElementById('dwellTimerBox');
    const display = document.getElementById('timerDisplay');
    timerBox.style.display = 'block';

    let timeLeft = durationSeconds;
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        let minutes = Math.floor(timeLeft / 60);
        let seconds = timeLeft % 60;
        
        display.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            alert('⚠️ انتهى وقت الانتظار المحدد للمحطة! يرجى التحرك الآن.');
            timerBox.style.display = 'none';
        }
        timeLeft--;
    }, 1000);
}

function skipDwellTime() {
    if (countdownInterval) clearInterval(countdownInterval);
    document.getElementById('dwellTimerBox').style.display = 'none';
}

async function changeTripStatus(newStatus) {
    const tripId = document.getElementById('currentTripId').value;
    if (!tripId || !confirm('تأكيد تغيير حالة الرحلة؟')) return;

    const res = await fetch(`/api/trips/${tripId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
    });

    if (res.ok) {
        if(newStatus === 'completed' && watchId) navigator.geolocation.clearWatch(watchId);
        loadDriverTrip();
    }
}

// استقبال تنبيهات الإدارة
socket.on('adminSendAlert', (data) => {
    if (currentDriverId && data.driverId == currentDriverId) {
        const alertBox = document.getElementById('alertBox');
        alertBox.innerHTML = `🔔 <b>تنبيه من الإدارة:</b><br>${data.message}`;
        alertBox.style.display = 'block';
        alertBox.style.backgroundColor = '#ff9800';
        alertBox.style.animation = 'none';
        setTimeout(() => alertBox.style.display = 'none', 10000);
    }
});

// **تنبيه الركاب (الومضة المتقطعة)**
socket.on('driverPassengerAlert', (data) => {
    const currentRouteId = document.getElementById('currentRouteId').value;
    if (data.routeId == currentRouteId) {
        const alertBox = document.getElementById('alertBox');
        alertBox.innerHTML = `🚨 <b>تنبيه عاجل:</b> ${data.message}`;
        alertBox.style.display = 'block';
        alertBox.style.backgroundColor = '#dc3545'; // أحمر طارئ
        alertBox.style.animation = 'pulse 0.8s infinite'; // تفعيل الومضة المتقطعة
    }
});

// إلغاء تنبيه الراكب
socket.on('driverCancelPassengerAlert', (data) => {
    const currentRouteId = document.getElementById('currentRouteId').value;
    if (data.routeId == currentRouteId) {
        const alertBox = document.getElementById('alertBox');
        alertBox.style.display = 'none';
    }
});