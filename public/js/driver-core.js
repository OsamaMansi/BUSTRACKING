const socket = io();
let currentDriverId = null;
let driverMap = null;
let driverMarker = null;
let watchId = null;
let countdownInterval = null;

// ==========================================
// [تعديل] التعرف التلقائي على السائق عند تحميل الصفحة
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    // 1. التحقق من تسجيل الدخول
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) {
        window.location.href = '/login.html'; // طرد المستخدم إذا لم يسجل دخول
        return;
    }
    
    const currentUser = JSON.parse(userStr);
    
    // 2. الحماية: التأكد أن من دخل هو سائق فعلاً
    if (currentUser.role !== 'driver') {
        alert("عذراً، هذه الشاشة مخصصة للسائقين فقط.");
        window.location.href = '/login.html';
        return;
    }

    // 3. تعيين هوية السائق تلقائياً من بيانات الدخول المحفوظة
    currentDriverId = currentUser.id;
    document.getElementById('driverNameDisplay').innerText = currentUser.full_name;

    // 4. استدعاء بيانات رحلته مباشرة دون تدخل منه
    await loadDriverTrip();
});

// [جديد] دالة تسجيل الخروج
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = '/login.html';
}

// ==========================================
// جلب وعرض رحلة السائق
// ==========================================
async function loadDriverTrip() {
    if (!currentDriverId) return;

    try {
        const res = await fetch(`/api/trips/driver/${currentDriverId}`);
        const trip = await res.json();

        const tripCard = document.getElementById('tripCard');
        const noTripMsg = document.getElementById('noTripMessage');
        const btnStart = document.getElementById('btnStart');
        const btnComplete = document.getElementById('btnComplete');
        const btnArrived = document.getElementById('btnArrivedStop');
        const btnCancel = document.getElementById('btnCancel'); // زر الإلغاء الجديد
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

            // التحكم بظهور الأزرار حسب حالة الرحلة
            if (trip.status === 'pending') {
                document.getElementById('lblStatus').innerText = 'مجدولة ⏳';
                btnStart.style.display = 'block';
                btnCancel.style.display = 'block'; // يمكن إلغاؤها قبل البدء
                btnComplete.style.display = 'none';
                btnArrived.style.display = 'none';
            } else if (trip.status === 'active') {
                document.getElementById('lblStatus').innerText = 'جارية 🟢';
                btnStart.style.display = 'none';
                btnComplete.style.display = 'block';
                btnArrived.style.display = 'block';
                btnCancel.style.display = 'block'; // يمكن إلغاؤها أثناء السير لطارئ
            }
        } else {
            // لا توجد رحلات
            tripCard.style.display = 'none';
            noTripMsg.style.display = 'block';
            mapDiv.style.display = 'none';
            if (watchId) navigator.geolocation.clearWatch(watchId);
        }
    } catch (err) {
        console.error("خطأ في جلب الرحلة", err);
    }
}

// ==========================================
// [جديد] دالة إلغاء الرحلة
// ==========================================
async function cancelTrip() {
    const tripId = document.getElementById('currentTripId').value;
    if (!tripId) return;

    // طلب إدخال سبب الإلغاء (نافذة منبثقة)
    const reason = prompt("يرجى إدخال سبب الإلغاء (مثال: عطل في الحافلة، إغلاق طرق):");
    
    // التحقق من أن السائق أدخل سبباً ولم يضغط Cancel
    if (reason === null || reason.trim() === "") {
        alert("يجب كتابة سبب الإلغاء لإتمام العملية.");
        return; 
    }

    // إرسال التحديث للسيرفر
    const res = await fetch(`/api/trips/${tripId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellation_reason: reason.trim() })
    });

    if (res.ok) {
        alert("تم إلغاء الرحلة بنجاح.");
        if (watchId) navigator.geolocation.clearWatch(watchId); // إيقاف الـ GPS
        loadDriverTrip(); // تحديث الواجهة لإخفاء الخريطة
    } else {
        alert("حدث خطأ، يرجى المحاولة مرة أخرى.");
    }
}

// ==========================================
// تهيئة الخريطة وتتبع الـ GPS (الكود السابق المستقر)
// ==========================================
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

            driverMap.panTo([lat, lng]);

            const currentRouteId = document.getElementById('currentRouteId').value;
            if (currentRouteId) {
                socket.emit('updateBusLocation', { routeId: currentRouteId, lat, lng, driverId: currentDriverId });
            }
        }, err => console.log(err), { enableHighAccuracy: true });
    }
}

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

// ==========================================
// الـ WebSockets واستقبال التنبيهات
// ==========================================
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

socket.on('driverPassengerAlert', (data) => {
    const currentRouteId = document.getElementById('currentRouteId').value;
    if (data.routeId == currentRouteId) {
        const alertBox = document.getElementById('alertBox');
        alertBox.innerHTML = `🚨 <b>تنبيه عاجل:</b> ${data.message}`;
        alertBox.style.display = 'block';
        alertBox.style.backgroundColor = '#dc3545'; 
        alertBox.style.animation = 'pulse 0.8s infinite'; 
    }
});

socket.on('driverCancelPassengerAlert', (data) => {
    const currentRouteId = document.getElementById('currentRouteId').value;
    if (data.routeId == currentRouteId) {
        const alertBox = document.getElementById('alertBox');
        alertBox.style.display = 'none';
    }
});