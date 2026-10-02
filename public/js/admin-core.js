const socket = io();

function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.sidebar ul li').forEach(li => li.classList.remove('active'));
    document.getElementById(sectionId + '-section').style.display = 'block';
    event.currentTarget.classList.add('active');

    if(sectionId === 'trips') { fetchTrips(); loadTripDropdowns(); }
    if(sectionId === 'users') fetchUsers();
    if(sectionId === 'buses') fetchBuses();
    if(sectionId === 'routes') fetchRoutes();
}

// ================= إدارة الرحلات =================
// ================= إدارة الرحلات (مصحح بالكامل) =================
let isEditingTrip = false;

// دالة دقيقة لتنسيق التاريخ المحلي لحقول datetime-local دون أخطاء توقيت
function formatLocalDateTime(dateString) {
    if (!dateString) return '';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}


// دالة نسخ رحلات الشهر الحالي إلى الشهر القادم
async function copyNextMonthTrips() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if(confirm(`هل أنت متأكد من نسخ جميع رحلات شهر (${month}) لعام (${year}) إلى الشهر القادم وتعيينها كحالة "مجدولة ⏳"؟`)) {
        try {
            const res = await fetch('/api/trips/copy-next-month', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month })
            });
            const result = await res.json();
            if(res.ok) {
                alert(result.message);
                fetchTrips();
            } else {
                alert('فشل النسخ: ' + result.error);
            }
        } catch(err) {
            alert('حدث خطأ في الاتصال بالسيرفر أثناء عملية النسخ.');
        }
    }
}

async function loadTripDropdowns() {
    try {
        const resU = await fetch('/api/users'); const users = await resU.json();
        document.getElementById('tripDriver').innerHTML = '<option value="" disabled selected>-- اختر السائق --</option>' + users.filter(u => u.role === 'driver').map(d => `<option value="${d.id}">${d.full_name}</option>`).join('');

        const resB = await fetch('/api/buses'); const buses = await resB.json();
        document.getElementById('tripBus').innerHTML = '<option value="" disabled selected>-- اختر الحافلة --</option>' + buses.map(b => `<option value="${b.id}">${b.plate_number} (سعة: ${b.capacity})</option>`).join('');

        const resR = await fetch('/api/routes'); const routes = await resR.json();
        document.getElementById('tripRoute').innerHTML = '<option value="" disabled selected>-- اختر المسار --</option>' + routes.map(r => `<option value="${r.id}">${r.route_name}</option>`).join('');
    } catch (err) {
        console.error('خطأ في تحميل القوائم:', err);
    }
}

async function fetchTrips() {
    try {
        const res = await fetch('/api/trips');
        const trips = await res.json();
        document.getElementById('tripsTableBody').innerHTML = trips.map(t => {
            let statusAr = t.status === 'pending' ? '<span class="status-pending">مجدولة ⏳</span>' : t.status === 'active' ? '<span class="status-active">جارية 🟢</span>' : '<span style="color:gray;">مكتملة ✔️</span>';
            let alertBtn = (t.status === 'active' || t.status === 'pending') ? `<button class="btn-alert" onclick="sendAlertToDriver('${t.driver_name}', ${t.id})">🔔 تنبيه</button>` : '';
            
            // تمرير التاريخ الخام كما هو للتعامل معه برمجياً بأمان
            const safeTimeStr = t.scheduled_time;

            return `<tr>
                <td>${t.driver_name}</td>
                <td>${t.bus_plate}</td>
                <td>${t.route_name}</td>
                <td dir="ltr">${new Date(t.scheduled_time).toLocaleString('ar-EG')}</td>
                <td>${statusAr}</td>
                <td>
                    ${alertBtn}
                    <button class="btn-edit" onclick="editTrip(${t.id}, ${t.driver_id}, ${t.bus_id}, ${t.route_id}, '${safeTimeStr}')">✏️ تعديل</button>
                    <button class="btn-delete" onclick="deleteTrip(${t.id})">🗑️ حذف</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('خطأ في جلب الرحلات للجدول:', err);
    }
}

document.getElementById('tripForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tripId = document.getElementById('tripId').value;
    const data = { 
        driver_id: document.getElementById('tripDriver').value, 
        bus_id: document.getElementById('tripBus').value, 
        route_id: document.getElementById('tripRoute').value, 
        scheduled_time: document.getElementById('tripTime').value 
    };
    
    const url = isEditingTrip ? `/api/trips/${tripId}` : '/api/trips';
    const method = isEditingTrip ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, { 
            method: method, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(data) 
        });
        const result = await res.json();
        
        if(res.ok) { 
            alert(result.message); 
            resetTripForm();
            fetchTrips(); 
        } else { 
            alert('تنبيه: ' + result.error); 
        }
    } catch (err) {
        alert('حدث خطأ في الاتصال بالسيرفر.');
    }
});

function editTrip(id, driverId, busId, routeId, timeStr) {
    isEditingTrip = true;
    document.getElementById('tripId').value = id;
    document.getElementById('tripDriver').value = driverId;
    document.getElementById('tripBus').value = busId;
    document.getElementById('tripRoute').value = routeId;
    
    // استخدام الدالة الدقيقة لتعبئة حقل التاريخ والوقت
    document.getElementById('tripTime').value = formatLocalDateTime(timeStr);

    document.getElementById('tripFormTitle').innerText = '✏️ تعديل بيانات الرحلة';
    const submitBtn = document.getElementById('tripSubmitBtn');
    submitBtn.innerText = '💾 حفظ التعديلات';
    submitBtn.style.background = '#ffc107';
    submitBtn.style.color = 'black';

    const cancelBtn = document.getElementById('tripCancelBtn');
    if(cancelBtn) cancelBtn.style.display = 'block';

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetTripForm() {
    isEditingTrip = false;
    document.getElementById('tripForm').reset();
    document.getElementById('tripId').value = '';

    document.getElementById('tripFormTitle').innerText = 'جدولة رحلة جديدة (Dispatch)';
    const submitBtn = document.getElementById('tripSubmitBtn');
    submitBtn.innerText = '➕ تعيين الرحلة';
    submitBtn.style.background = '#28a745';
    submitBtn.style.color = 'white';

    const cancelBtn = document.getElementById('tripCancelBtn');
    if(cancelBtn) cancelBtn.style.display = 'none';
}

async function deleteTrip(id) {
    if(confirm('هل أنت متأكد من حذف هذه الرحلة التشغيلية نهائياً؟')) {
        try {
            const res = await fetch(`/api/trips/${id}`, { method: 'DELETE' });
            const result = await res.json();
            if(res.ok) {
                alert(result.message);
                fetchTrips();
            } else {
                alert('فشل الحذف: ' + (result.error || 'خطأ غير معروف'));
            }
        } catch (err) {
            alert('حدث خطأ في الاتصال بالسيرفر أثناء محاولة الحذف.');
        }
    }
}

function sendAlertToDriver(driverName, driverId) {
    const msg = prompt(`تنبيه عاجل للسائق ( ${driverName} ):`);
    if (msg && msg.trim() !== '') { 
        socket.emit('adminSendAlert', { driverId: driverId, message: msg }); 
        alert('تم إرسال التنبيه اللحظي بنجاح 🚀'); 
    }
}

// ================= إدارة المستخدمين =================
let isEditingUser = false;
async function fetchUsers() {
    const res = await fetch('/api/users'); const users = await res.json();
    document.getElementById('usersTableBody').innerHTML = users.map(u => `<tr>
        <td>${u.full_name}</td><td>${u.phone || '-'}</td><td>${u.email || '-'}</td><td>${u.role}</td>
        <td>${u.is_active ? '<span class="status-active">فعال</span>' : '<span class="status-inactive">موقوف</span>'}</td>
        <td>
            <button class="btn-edit" onclick="editUser(${u.id}, '${u.full_name}', '${u.email || ''}', '${u.phone || ''}', '${u.role}')">✏️</button>
            <button class="${u.is_active ? 'btn-stop' : 'btn-start'}" onclick="toggleUser(${u.id}, ${!u.is_active})">${u.is_active ? 'إيقاف' : 'تفعيل'}</button>
            <button class="btn-delete" onclick="deleteUser(${u.id})">🗑️</button>
        </td></tr>`).join('');
}
document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { full_name: document.getElementById('fullName').value, email: document.getElementById('email').value, phone: document.getElementById('phone').value, password: document.getElementById('password').value, role: document.getElementById('role').value };
    const id = document.getElementById('userId').value;
    const res = await fetch(isEditingUser ? `/api/users/${id}` : '/api/users', { method: isEditingUser ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if(res.ok) { resetUserForm(); fetchUsers(); }
});
function editUser(id, name, email, phone, role) {
    isEditingUser = true; document.getElementById('userFormTitle').innerText = 'تعديل المستخدم'; document.getElementById('userCancelBtn').style.display = 'block';
    document.getElementById('userId').value = id; document.getElementById('fullName').value = name; document.getElementById('email').value = email; document.getElementById('phone').value = phone; document.getElementById('role').value = role; document.getElementById('password').required = false;
}
function resetUserForm() {
    isEditingUser = false; document.getElementById('userForm').reset(); document.getElementById('userId').value = ''; document.getElementById('userCancelBtn').style.display = 'none'; document.getElementById('password').required = true;
}
async function toggleUser(id, active) { await fetch(`/api/users/${id}/toggle-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: active }) }); fetchUsers(); }
async function deleteUser(id) { if(confirm('تأكيد الحذف؟')) { await fetch(`/api/users/${id}`, { method: 'DELETE' }); fetchUsers(); } }

// ================= إدارة الحافلات =================
let isEditingBus = false;
async function fetchBuses() {
    const res = await fetch('/api/buses'); const buses = await res.json();
    document.getElementById('busesTableBody').innerHTML = buses.map(b => `<tr>
        <td>${b.plate_number}</td><td>${b.capacity}</td><td>${b.is_active ? '<span class="status-active">فعال</span>' : '<span class="status-inactive">موقوف</span>'}</td>
        <td>
            <button class="btn-edit" onclick="editBus(${b.id}, '${b.plate_number}', ${b.capacity})">✏️</button>
            <button class="${b.is_active ? 'btn-stop' : 'btn-start'}" onclick="toggleBus(${b.id}, ${!b.is_active})">${b.is_active ? 'إيقاف' : 'تفعيل'}</button>
            <button class="btn-delete" onclick="deleteBus(${b.id})">🗑️</button>
        </td></tr>`).join('');
}
document.getElementById('busForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { plate_number: document.getElementById('plateNumber').value, capacity: document.getElementById('capacity').value };
    const id = document.getElementById('busId').value;
    const res = await fetch(isEditingBus ? `/api/buses/${id}` : '/api/buses', { method: isEditingBus ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if(res.ok) { resetBusForm(); fetchBuses(); }
});
function editBus(id, plate, cap) {
    isEditingBus = true; document.getElementById('busCancelBtn').style.display = 'block';
    document.getElementById('busId').value = id; document.getElementById('plateNumber').value = plate; document.getElementById('capacity').value = cap;
}
function resetBusForm() { isEditingBus = false; document.getElementById('busForm').reset(); document.getElementById('busId').value = ''; document.getElementById('busCancelBtn').style.display = 'none'; }
async function toggleBus(id, active) { await fetch(`/api/buses/${id}/toggle-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: active }) }); fetchBuses(); }
async function deleteBus(id) { if(confirm('تأكيد الحذف؟')) { await fetch(`/api/buses/${id}`, { method: 'DELETE' }); fetchBuses(); } }

// ================= إدارة المسارات =================
let isEditingRoute = false;
async function fetchRoutes() {
    const res = await fetch('/api/routes'); const routes = await res.json();
    document.getElementById('routesTableBody').innerHTML = routes.map(r => {
        const desc = r.description ? r.description.replace(/'/g, "\\'") : '';
        return `<tr><td>${r.route_name}</td><td>${r.description || '-'}</td>
        <td>
            <button class="btn-start" onclick="openMapModal(${r.id}, '${r.route_name}', '${desc}', ${r.allowed_deviation_meters || 100})">🗺️ إدارة المحطات</button>
            <button class="btn-edit" onclick="editRoute(${r.id}, '${r.route_name}', '${desc}')">✏️</button>
            <button class="btn-delete" onclick="deleteRoute(${r.id})">🗑️</button>
        </td></tr>`;
    }).join('');
}
document.getElementById('routeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { route_name: document.getElementById('routeName').value, description: document.getElementById('routeDesc').value };
    const id = document.getElementById('routeId').value;
    const res = await fetch(isEditingRoute ? `/api/routes/${id}` : '/api/routes', { method: isEditingRoute ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if(res.ok) { resetRouteForm(); fetchRoutes(); }
});
function editRoute(id, name, desc) {
    isEditingRoute = true; document.getElementById('routeCancelBtn').style.display = 'block';
    document.getElementById('routeId').value = id; document.getElementById('routeName').value = name; document.getElementById('routeDesc').value = desc;
}
function resetRouteForm() { isEditingRoute = false; document.getElementById('routeForm').reset(); document.getElementById('routeId').value = ''; document.getElementById('routeCancelBtn').style.display = 'none'; }
async function deleteRoute(id) { if(confirm('تأكيد الحذف؟')) { await fetch(`/api/routes/${id}`, { method: 'DELETE' }); fetchRoutes(); } }

// بدء التشغيل
fetchTrips();
loadTripDropdowns();