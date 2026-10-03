const socket = io();
let currentDriverId = null;
let driverMap = null;
let driverMarker = null;
let watchId = null;
let allDriverTrips = [];
let countdownInterval = null; // عداد موعد الانطلاق
let dwellInterval = null;     // عداد المكوث في المحطة

// ==========================================
// 1. التحميل الأولي والتعرف على السائق
// ==========================================
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
// 2. جلب وتوزيع بيانات رحلات السائق
// ==========================================
async function loadDriverTrip() {
    if (!currentDriverId) return;

    try {
        const res = await fetch(`/api/trips/driver/${currentDriverId}/today`);
        allDriverTrips = await res.json();

        const tripCard = document.getElementById('tripCard');
        const noTripMsg = document.getElementById('noTripMessage');
        const scheduleBox = document.getElementById('dailyScheduleBox');
        const mapDiv = document.getElementById('driverMap');

        if (allDriverTrips.length > 0) {
            scheduleBox.style.display = 'block';
            
            // استخراج الرحلة الحالية (الجارية أو أول رحلة مجدولة)
            const currentTrip = allDriverTrips.find(t => t.status === 'active') || allDriverTrips.find(t => t.status === 'pending');

            if (currentTrip) {
                noTripMsg.style.display = 'none';
                tripCard.style.display = 'block';
                mapDiv.style.display = 'block';

                // تعبئة البيانات المخفية والظاهرة
                document.getElementById('currentTripId').value = currentTrip.id;
                document.getElementById('currentRouteId').value = currentTrip.route_id;
                document.getElementById('currentScheduledTime').value = currentTrip.scheduled_time;
                document.getElementById('lblRouteName').innerText = currentTrip.route_name;
                document.getElementById('lblBusPlate').innerText = currentTrip.bus_plate;

                // تفعيل العداد التناقصي للوقت المجدول
                if (currentTrip.scheduled_time) {
                    startCountdownTimer(currentTrip.scheduled_time);
                } else {
                    document.getElementById('lblScheduledTime').innerText = "غير محدد";
                }

                // تهيئة الخريطة للمسار الحالي
                initDriverMap(currentTrip.route_id);

                // التحكم بظهور الأزرار حسب حالة الرحلة
                const btnStart = document.getElementById('btnStart');
                const btnComplete = document.getElementById('btnComplete');
                const btnCancel = document.getElementById('btnCancel');
                const btnDwell = document.getElementById('btnDwellStop');
                const dwellTimer = document.getElementById('dwellTimerDisplay');

                if (currentTrip.status === 'pending') {
                    document.getElementById('lblStatus').innerText = 'مجدولة ⏳';
                    if(btnStart) btnStart.style.display = 'block';
                    if(btnCancel) btnCancel.style.display = 'block';
                    if(btnComplete) btnComplete.style.display = 'none';
                    if(btnDwell) btnDwell.style.display = 'none';
                    if(dwellTimer) dwellTimer.style.display = 'none';
                } else if (currentTrip.status === 'active') {
                    document.getElementById('lblStatus').innerText = 'جارية 🟢';
                    if(btnStart) btnStart.style.display = 'none';
                    if(btnCancel) btnCancel.style.display = 'block';
                    if(btnComplete) btnComplete.style.display = 'block';
                    // إظهار زر التوقف المؤقت عندما تكون الرحلة جارية
                    if(btnDwell) btnDwell.style.display = 'block';
                }
            } else {
                // إذا لم توجد رحلة حالية أو مجدولة
                tripCard.style.display = 'none'; 
                mapDiv.style.display = 'none'; 
                noTripMsg.style.display = 'block';
                if (watchId) navigator.geolocation.clearWatch(watchId);
                if (countdownInterval) clearInterval(countdownInterval);
                if (dwellInterval) clearInterval(dwellInterval);
            }

            // عرض قائمة الرحلات السفلية وتصفيتها
            filterDriverTrips();

        } else {
            tripCard.style.display = 'none'; 
            mapDiv.style.display = 'none'; 
            scheduleBox.style.display = 'none'; 
            noTripMsg.style.display = 'block';
        }
    } catch (err) { console.error('خطأ في جلب بيانات الرحلات:', err); }
}

// ==========================================
// 3. دوال العدادات (موعد الانطلاق + وقت المكوث)
// ==========================================

// عداد موعد الانطلاق المجدول
function startCountdownTimer(targetTimeStr) {
    if (countdownInterval) clearInterval(countdownInterval);
    const targetTime = new Date(targetTimeStr).getTime();

    countdownInterval = setInterval(() => {
        const now = new Date().getTime();
        const distance = targetTime - now;
        const timeElement = document.getElementById('lblScheduledTime');
        if (!timeElement) return;

        if (distance < 0) {
            timeElement.innerHTML = "🔴 حان وقت الانطلاق (أو فائت)";
            clearInterval(countdownInterval);
            return;
        }

        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        timeElement.innerHTML = `${new Date(targetTimeStr).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })} <span style="font-size:12px; color:#d9534f;">(باقي: ${hours}س ${minutes}د ${seconds}ث)</span>`;
    }, 1000);
}

// عداد التوقف المؤقت والمكوث في المحطة (تحديث: مفتاح تشغيل وإيقاف)
function startDwellCountdown(durationSeconds = 120) {
    const timerDisplay = document.getElementById('dwellTimerDisplay');
    const btnDwell = document.getElementById('btnDwellStop');
    if (!timerDisplay) return;

    // 1. إذا كان العداد يعمل مسبقاً، قم بإيقافه (استئناف المسير)
    if (dwellInterval) {
        clearInterval(dwellInterval);
        dwellInterval = null;
        timerDisplay.style.display = 'none';
        if (btnDwell) {
            btnDwell.style.background = '#17a2b8';
            btnDwell.innerText = '🛑 توقف مؤقت جديد في المحطة';
        }
        return;
    }

    // 2. إذا لم يكن العداد يعمل، قم بتشغيله
    timerDisplay.style.display = 'block';
    if(btnDwell) {
        btnDwell.style.background = '#6c757d';
        btnDwell.innerText = '🚶‍♂️ استئناف المسير (إنهاء التوقف)';
    }
    
    let remainingTime = durationSeconds;
    dwellInterval = setInterval(() => {
        const mins = Math.floor(remainingTime / 60);
        const secs = remainingTime % 60;
        timerDisplay.innerHTML = `⏱️ وقت المكوث المتبقي بالمحطة: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        if (remainingTime <= 0) {
            clearInterval(dwellInterval);
            dwellInterval = null;
            timerDisplay.innerHTML = "🔔 انتهى وقت المكوث المقدر! يمكنك متابعة المسير.";
            if(btnDwell) {
                btnDwell.style.background = '#17a2b8';
                btnDwell.innerText = '🛑 توقف مؤقت جديد في المحطة';
            }
        }
        remainingTime--;
    }, 1000);
}

// ==========================================
// 4. تصفية وعرض قائمة الرحلات
// ==========================================
function filterDriverTrips() {
    const filterSelect = document.getElementById('tripFilterSelect');
    const filterValue = filterSelect ? filterSelect.value : 'pending';
    const scheduleList = document.getElementById('scheduleList');
    if (!scheduleList) return;

    let filtered = allDriverTrips;
    if (filterValue === 'pending') {
        filtered = allDriverTrips.filter(t => t.status === 'pending' || t.status === 'active');
    } else if (filterValue === 'completed') {
        filtered = allDriverTrips.filter(t => t.status === 'completed');
    } else if (filterValue === 'all') {
        filtered = allDriverTrips;
    }

    if (filtered.length === 0) {
        scheduleList.innerHTML = `<li style="text-align: center; color: #777; padding: 15px;">لا توجد رحلات تطابق هذا الخيار</li>`;
        return;
    }

    let scheduleHtml = '';
    filtered.forEach(t => {
        let statusIcon = t.status === 'completed' ? '✔️ منتهية' : t.status === 'cancelled' ? '❌ ملغاة' : t.status === 'active' ? '🟢 جارية' : '⏳ مجدولة';
        const timeStr = t.scheduled_time ? new Date(t.scheduled_time).toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' }) : 'غير محدد';
        
        scheduleHtml += `
            <li style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${t.route_name}</strong> - 🕒 ${timeStr} <br>
                <span style="font-size:12px; color:#666;">الحافلة: ${t.bus_plate} | الحالة: ${statusIcon}</span>
            </li>
        `;
    });
    scheduleList.innerHTML = scheduleHtml;
}

// ==========================================
// 5. إدارة حالة الرحلة (بدء، إنهاء، إلغاء)
// ==========================================
async function changeTripStatus(newStatus) {
    const tripId = document.getElementById('currentTripId').value;
    const scheduledTimeStr = document.getElementById('currentScheduledTime').value;
    if (!tripId) return;

    let notes = null;
    if (newStatus === 'active' && scheduledTimeStr) {
        const scheduledTime = new Date(scheduledTimeStr);
        const now = new Date();
        const diffHours = (scheduledTime - now) / (1000 * 60 * 60);

        // منع البدء قبل 4 ساعات
        if (diffHours > 4) {
            alert("⚠️ لا يمكنك بدء الرحلة قبل موعدها بأكثر من 4 ساعات.");
            return;
        }

        // إجبار السائق على كتابة ملاحظة إذا بدأ الرحلة مبكراً
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
        if(countdownInterval) clearInterval(countdownInterval);
        if(dwellInterval) clearInterval(dwellInterval);
        loadDriverTrip();
    }
}

async function cancelTrip() {
    const tripId = document.getElementById('currentTripId').value;
    if (!tripId) return;
    const reason = prompt("يرجى إدخال سبب الإلغاء:");
    if (reason === null || reason.trim() === "") { alert("يجب كتابة سبب الإلغاء لإتمام العملية."); return; }
    
    const res = await fetch(`/api/trips/${tripId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellation_reason: reason.trim() })
    });
    if (res.ok) {
        alert("تم إلغاء الرحلة بنجاح.");
        if (watchId) navigator.geolocation.clearWatch(watchId);
        if (countdownInterval) clearInterval(countdownInterval);
        if (dwellInterval) clearInterval(dwellInterval);
        loadDriverTrip();
    }
}

// ==========================================
// 6. تهيئة الخريطة وتتبع الـ GPS اللحظي
// ==========================================
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
    } catch(err) { console.error("خطأ في جلب المحطات:", err); }

    if (navigator.geolocation) {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = navigator.geolocation.watchPosition(pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (!driverMarker) {
                driverMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'bus-icon', html: '🚌', iconSize: [30, 30] }) }).addTo(driverMap);
            } else { driverMarker.setLatLng([lat, lng]); }
            driverMap.panTo([lat, lng]);
            
            // إرسال الإحداثيات اللحظية عبر Socket.io ليراها الركاب
            const currentRouteIdVal = document.getElementById('currentRouteId').value;
            if (currentRouteIdVal) {
                socket.emit('updateBusLocation', { routeId: currentRouteIdVal, lat, lng, driverId: currentDriverId });
            }
        }, err => console.log(err), { enableHighAccuracy: true });
    }
}