const socket = io();
let currentDriverId = null;
let driverMap = null;
let driverMarker = null;
let watchId = null;

// التعرف التلقائي على السائق عند تحميل الصفحة
window.addEventListener('DOMContentLoaded', async () => {
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) { window.location.href = '/login.html'; return; }
    
    const currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'driver') {
        alert("عذراً، هذه الشاشة مخصصة للسائقين فقط.");
        window.location.href = '/login.html'; return;
    }

    currentDriverId = currentUser.id;
    document.getElementById('driverNameDisplay').innerText = currentUser.full_name;
    await loadDriverTrip();
});

function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = '/login.html';
}

// ==========================================
// [محدث] جلب رحلات اليوم وفرزها 
// ==========================================
async function loadDriverTrip() {
    if (!currentDriverId) return;

    try {
        const res = await fetch(`/api/trips/driver/${currentDriverId}/today`);
        const trips = await res.json();

        const tripCard = document.getElementById('tripCard');
        const noTripMsg = document.getElementById('noTripMessage');
        const scheduleBox = document.getElementById('dailyScheduleBox');
        const scheduleList = document.getElementById('scheduleList');
        const mapDiv = document.getElementById('driverMap');

        if (trips.length > 0) {
            scheduleBox.style.display = 'block';
            
            // 1. استخراج الرحلة الحالية (الجارية أو أول رحلة مجدولة)
            const currentTrip = trips.find(t => t.status === 'active') || trips.find(t => t.status === 'pending');

            if (currentTrip) {
                noTripMsg.style.display = 'none';
                tripCard.style.display = 'block';
                mapDiv.style.display = 'block';

                document.getElementById('currentTripId').value = currentTrip.id;
                document.getElementById('currentRouteId').value = currentTrip.route_id;
                document.getElementById('currentScheduledTime').value = currentTrip.scheduled_time;
                document.getElementById('lblRouteName').innerText = currentTrip.route_name;
                document.getElementById('lblBusPlate').innerText = currentTrip.bus_plate;

                // تنسيق وعرض الوقت المجدول
                if (currentTrip.scheduled_time) {
                    const timeObj = new Date(currentTrip.scheduled_time);
                    document.getElementById('lblScheduledTime').innerText = timeObj.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
                } else {
                    document.getElementById('lblScheduledTime').innerText = "غير محدد";
                }

                initDriverMap(currentTrip.route_id);

                const btnStart = document.getElementById('btnStart');
                const btnComplete = document.getElementById('btnComplete');
                const btnCancel = document.getElementById('btnCancel');

                if (currentTrip.status === 'pending') {
                    document.getElementById('lblStatus').innerText = 'مجدولة ⏳';
                    btnStart.style.display = 'block';
                    btnCancel.style.display = 'block';
                    btnComplete.style.display = 'none';
                } else if (currentTrip.status === 'active') {
                    document.getElementById('lblStatus').innerText = 'جارية 🟢';
                    btnStart.style.display = 'none';
                    btnCancel.style.display = 'block';
                    btnComplete.style.display = 'block';
                }
            } else {
                tripCard.style.display = 'none'; mapDiv.style.display = 'none'; noTripMsg.style.display = 'block';
                if (watchId) navigator.geolocation.clearWatch(watchId);
            }

            // 2. تعبئة قائمة الرحلات في أسفل الشاشة
            let scheduleHtml = '';
            trips.forEach(t => {
                let statusIcon = '';
                if(t.status === 'completed') statusIcon = '✔️ منتهية';
                else if(t.status === 'cancelled') statusIcon = '❌ ملغاة';
                else if(t.status === 'active') statusIcon = '🟢 جارية';
                else statusIcon = '⏳ مجدولة';

                const timeStr = t.scheduled_time ? new Date(t.scheduled_time).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }) : 'غير محدد';
                
                scheduleHtml += `
                    <li>
                        <strong>${t.route_name}</strong> - 🕒 ${timeStr} <br>
                        <span style="font-size:12px; color:#666;">الحافلة: ${t.bus_plate} | الحالة: ${statusIcon}</span>
                    </li>
                `;
            });
            scheduleList.innerHTML = scheduleHtml;

        } else {
            tripCard.style.display = 'none'; mapDiv.style.display = 'none'; scheduleBox.style.display = 'none'; noTripMsg.style.display = 'block';
        }
    } catch (err) { console.error(err); }
}

// ==========================================
// [محدث] تغيير حالة الرحلة + حماية الوقت (4 ساعات) والملاحظات
// ==========================================
async function changeTripStatus(newStatus) {
    const tripId = document.getElementById('currentTripId').value;
    const scheduledTimeStr = document.getElementById('currentScheduledTime').value;
    if (!tripId) return;

    let notes = null;

    if (newStatus === 'active' && scheduledTimeStr) {
        const scheduledTime = new Date(scheduledTimeStr);
        const now = new Date();
        // حساب الفرق بالساعات بين وقت الرحلة والوقت الحالي
        const diffHours = (scheduledTime - now) / (1000 * 60 * 60);

        // 1. منع بدء الرحلة إذا كان متبقي أكثر من 4 ساعات
        if (diffHours > 4) {
            alert("⚠️ لا يمكنك بدء الرحلة قبل موعدها بأكثر من 4 ساعات.");
            return;
        }

        // 2. إجبار السائق على كتابة ملاحظة إذا بدأ الرحلة مبكراً (قبل موعدها ولو بدقيقة)
        if (diffHours > 0) {
            const reason = prompt("أنت تقوم ببدء الرحلة قبل موعدها المجدول. يرجى كتابة السبب (إلزامي):");
            if (reason === null || reason.trim() === "") {
                alert("يجب كتابة السبب لبدء الرحلة مبكراً.");
                return;
            }
            notes = reason.trim();
        }
    } else {
        if (!confirm('تأكيد تغيير حالة الرحلة؟')) return;
    }

    const res = await fetch(`/api/trips/${tripId}/status-with-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, start_notes: notes })
    });

    if (res.ok) {
        if(newStatus === 'completed' && watchId) navigator.geolocation.clearWatch(watchId);
        loadDriverTrip();
    }
}

// ==========================================
// دالة الإلغاء وتتبع الـ GPS (بدون تغيير)
// ==========================================
async function cancelTrip() {
    const tripId = document.getElementById('currentTripId').value;
    if (!tripId) return;
    const reason = prompt("يرجى إدخال سبب الإلغاء:");
    if (reason === null || reason.trim() === "") { alert("يجب كتابة سبب الإلغاء لإتمام العملية."); return; }
    
    // نستخدم مسار cancel الموجود مسبقاً في routes/trips.js
    const res = await fetch(`/api/trips/${tripId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellation_reason: reason.trim() })
    });
    if (res.ok) {
        alert("تم إلغاء الرحلة بنجاح.");
        if (watchId) navigator.geolocation.clearWatch(watchId);
        loadDriverTrip();
    }
}

async function initDriverMap(routeId) {
    if (!driverMap) {
        driverMap = L.map('driverMap').setView([31.95, 35.91], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(driverMap);
    } else { driverMap.invalidateSize(); }

    try {
        const res = await fetch(`/api/stops/${routeId}`);
        const stops = await res.json();
        stops.forEach((s) => {
            L.marker([s.latitude, s.longitude]).addTo(driverMap).bindPopup(`<b>محطة: ${s.stop_name}</b>`);
        });
        if (stops.length > 0) driverMap.setView([stops[0].latitude, stops[0].longitude], 14);
    } catch(err) {}

    if (navigator.geolocation) {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = navigator.geolocation.watchPosition(pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (!driverMarker) {
                driverMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'bus-icon', html: '🚌', iconSize: [30, 30] }) }).addTo(driverMap);
            } else { driverMarker.setLatLng([lat, lng]); }
            driverMap.panTo([lat, lng]);
            const routeId = document.getElementById('currentRouteId').value;
            if (routeId) socket.emit('updateBusLocation', { routeId, lat, lng, driverId: currentDriverId });
        }, err => console.log(err), { enableHighAccuracy: true });
    }
}