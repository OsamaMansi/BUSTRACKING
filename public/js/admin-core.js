const socket = io();

// ==========================================
// دالة تسجيل الخروج للمدير
// ==========================================
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = '/login.html';
}

function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.sidebar ul li').forEach(li => li.classList.remove('active'));
    document.getElementById(sectionId + '-section').style.display = 'block';
    
    // التحقق من وجود event لمنع أخطاء النقر على أزرار غير مرتبطة بالقائمة مباشرة
    if (event && event.currentTarget && event.currentTarget.hasAttribute('onclick')) {
        event.currentTarget.classList.add('active');
    }

    if(sectionId === 'trips') { fetchTrips(); loadTripDropdowns(); }
    if(sectionId === 'users') fetchUsers();
    if(sectionId === 'buses') fetchBuses();
    if(sectionId === 'routes') fetchRoutes();
    // [إضافة] تشغيل خريطة المراقبة العامة عند فتح قسم المراقبة
    if(sectionId === 'monitoring') initGlobalMonitoringMap();
}

// ================= إدارة الرحلات (مدمج مع نظام الفرز والترتيب والحماية) =================
let isEditingTrip = false;
let globalTripsCache = []; // [إضافة] لتخزين الرحلات محلياً وتسريع عملية الفرز

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

// تحميل القوائم المنسدلة للجدولة مع إظهار الـ IDs
async function loadTripDropdowns() {
    try {
        const resU = await fetch('/api/users'); 
        const users = await resU.json();
        const drivers = users.filter(u => u.role === 'driver');

        document.getElementById('tripDriver').innerHTML = '<option value="" disabled selected>-- اختر السائق --</option>' + 
            drivers.map(d => `<option value="${d.id}">(ID: ${d.id}) ${d.full_name}</option>`).join('');

        // [إضافة] تعبئة قائمة فلترة السائقين إن وجدت في واجهة HTML
        const filterDriverSelect = document.getElementById('filterTripDriver');
        if(filterDriverSelect) {
            filterDriverSelect.innerHTML = '<option value="all">جميع السائقين 🚌</option>' + 
                drivers.map(d => `<option value="${d.id}">${d.full_name}</option>`).join('');
        }

        const resB = await fetch('/api/buses'); 
        const buses = await resB.json();
        document.getElementById('tripBus').innerHTML = '<option value="" disabled selected>-- اختر الحافلة --</option>' + 
            buses.map(b => `<option value="${b.id}">(ID: ${b.id}) ${b.plate_number} (سعة: ${b.capacity})</option>`).join('');

        const resR = await fetch('/api/routes'); 
        const routes = await resR.json();
        document.getElementById('tripRoute').innerHTML = '<option value="" disabled selected>-- اختر المسار --</option>' + 
            routes.map(r => `<option value="${r.id}">(ID: ${r.id}) ${r.route_name}</option>`).join('');
    } catch (err) {
        console.error('خطأ في تحميل القوائم:', err);
    }
}

// جلب الرحلات (تم فصلها عن الطباعة لتسريع الفرز المباشر)
async function fetchTrips() {
    try {
        const res = await fetch('/api/trips');
        globalTripsCache = await res.json(); // حفظ النسخة الأصلية
        renderFilteredTrips(); // استدعاء دالة الفرز والطباعة
    } catch (err) {
        console.error('خطأ في جلب الرحلات للجدول:', err);
    }
}

// [إضافة] دالة مسؤولة عن الفرز، الترتيب العكسي، والطباعة، وحماية الرحلات المنتهية
function renderFilteredTrips() {
    const statusFilter = document.getElementById('filterTripStatus') ? document.getElementById('filterTripStatus').value : 'all';
    const driverFilter = document.getElementById('filterTripDriver') ? document.getElementById('filterTripDriver').value : 'all';

    let filtered = [...globalTripsCache];

    // الفرز حسب الحالة
    if (statusFilter === 'active_now') {
        filtered = filtered.filter(t => t.status === 'active');
    } else if (statusFilter !== 'all') {
        filtered = filtered.filter(t => t.status === statusFilter);
    }

    // الفرز حسب السائق
    if (driverFilter !== 'all') {
        filtered = filtered.filter(t => String(t.driver_id) === String(driverFilter));
    }

    // الترتيب العكسي (الأحدث أولاً)
    filtered.sort((a, b) => new Date(b.scheduled_time) - new Date(a.scheduled_time));

    const tbody = document.getElementById('tripsTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; font-weight: bold; padding: 20px;">لا توجد رحلات تطابق معايير الفرز الحالية</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(t => {
        let statusAr = t.status === 'pending' ? '<span class="status-pending">مجدولة ⏳</span>' : 
                       t.status === 'active' ? '<span class="status-active">جارية 🟢</span>' : 
                       t.status === 'completed' ? '<span style="color:green; font-weight:bold;">مكتملة ✔️</span>' : 
                       '<span style="color:red; font-weight:bold;">ملغاة ❌</span>';
        
        let alertBtn = (t.status === 'active' || t.status === 'pending') ? `<button class="btn-alert" onclick="sendAlertToDriver('${t.driver_name}', ${t.id})">🔔 تنبيه</button>` : '';
        const safeTimeStr = t.scheduled_time;

        // تطبيق شرط عدم التعديل على الرحلات المنتهية أو الملغاة
        let actionButtons = '';
        if (t.status === 'completed' || t.status === 'cancelled') {
            actionButtons = `<span style="color: #666; font-size: 12px; font-weight: bold;">🔒 سجل محمي (منتهية/ملغاة)</span>`;
        } else {
            actionButtons = `
                ${alertBtn}
                <button class="btn-edit" onclick="editTrip(${t.id}, ${t.driver_id}, ${t.bus_id}, ${t.route_id}, '${safeTimeStr}')">✏️ تعديل</button>
                <button class="btn-delete" onclick="deleteTrip(${t.id})">🗑️ حذف</button>
            `;
        }

        return `<tr>
            <td>(ID: ${t.driver_id}) ${t.driver_name}</td>
            <td>${t.bus_plate}</td>
            <td>${t.route_name}</td>
            <td dir="ltr">${new Date(t.scheduled_time).toLocaleString('ar-EG')}</td>
            <td>${statusAr}</td>
            <td>${actionButtons}</td>
        </tr>`;
    }).join('');
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

// ================= إدارة المستخدمين (دون أي تغيير أو حذف) =================
let isEditingUser = false;
async function fetchUsers() {
    const res = await fetch('/api/users'); 
    const users = await res.json();
    
    document.getElementById('usersTableBody').innerHTML = users.map(u => {
        let roleAr = '';
        if(u.role === 'driver') roleAr = 'سائق 🚌';
        else if(u.role === 'passenger') roleAr = 'راكب 🧍‍♂️';
        else if(u.role === 'admin') roleAr = 'مدير نظام ⚙️';
        else if(u.role === 'escort') roleAr = 'مراقب 🧑‍🏫';
        else roleAr = u.role;

        const safeName = u.full_name ? u.full_name.replace(/'/g, "\\'") : '';

        return `<tr>
        <td>${u.full_name}</td>
        <td>${u.phone || '-'}</td>
        <td>${u.email || '-'}</td>
        <td style="font-weight:bold;">${roleAr}</td>
        <td>${u.is_active ? '<span class="status-active">فعال</span>' : '<span class="status-inactive">موقوف</span>'}</td>
        <td>
            <button class="btn-edit" onclick="editUser(${u.id}, '${safeName}', '${u.email || ''}', '${u.phone || ''}', '${u.role}')">✏️</button>
            <button class="${u.is_active ? 'btn-stop' : 'btn-start'}" onclick="toggleUser(${u.id}, ${!u.is_active})">${u.is_active ? 'إيقاف' : 'تفعيل'}</button>
            <button class="btn-delete" onclick="deleteUser(${u.id})">🗑️</button>
        </td></tr>`;
    }).join('');
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { 
        full_name: document.getElementById('fullName').value, 
        email: document.getElementById('email').value, 
        phone: document.getElementById('phone').value, 
        password: document.getElementById('password').value, 
        role: document.getElementById('role').value 
    };
    const id = document.getElementById('userId').value;
    const res = await fetch(isEditingUser ? `/api/users/${id}` : '/api/users', { 
        method: isEditingUser ? 'PUT' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
    });
    if(res.ok) { resetUserForm(); fetchUsers(); }
});

function editUser(id, name, email, phone, role) {
    isEditingUser = true; 
    document.getElementById('userFormTitle').innerText = 'تعديل المستخدم'; 
    document.getElementById('userCancelBtn').style.display = 'block';
    document.getElementById('userId').value = id; 
    document.getElementById('fullName').value = name; 
    document.getElementById('email').value = email; 
    document.getElementById('phone').value = phone; 
    document.getElementById('role').value = role; 
    document.getElementById('password').required = false;
}

function resetUserForm() {
    isEditingUser = false; 
    document.getElementById('userForm').reset(); 
    document.getElementById('userId').value = ''; 
    document.getElementById('userCancelBtn').style.display = 'none'; 
    document.getElementById('password').required = true;
}

async function toggleUser(id, active) { 
    await fetch(`/api/users/${id}/toggle-status`, { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ is_active: active }) 
    }); 
    fetchUsers(); 
}

async function deleteUser(id) { 
    if(confirm('تأكيد الحذف؟')) { 
        await fetch(`/api/users/${id}`, { method: 'DELETE' }); 
        fetchUsers(); 
    } 
}

// ================= إدارة الحافلات (دون أي تغيير أو حذف) =================
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

// ================= إدارة المسارات (مستعاد كما كان بالضبط دون فقدان) =================
let isEditingRoute = false;
async function fetchRoutes() {
    const res = await fetch('/api/routes'); const routes = await res.json();
    document.getElementById('routesTableBody').innerHTML = routes.map(r => {
        const desc = r.description ? r.description.replace(/'/g, "\\'") : '';
        const rName = r.route_name ? r.route_name.replace(/'/g, "\\'") : '';
        return `<tr><td>${r.route_name}</td><td>${r.description || '-'}</td>
        <td>
            <button class="btn-start" onclick="openMapModal(${r.id}, '${rName}', '${desc}', ${r.allowed_deviation_meters || 100})">🗺️ إدارة المحطات</button>
            <button class="btn-edit" onclick="editRoute(${r.id}, '${rName}', '${desc}')">✏️</button>
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

// [إصلاح] تمت استعادة هذه الدالة كما كانت بالضبط في كودك القديم
function editRoute(id, name, desc) {
    isEditingRoute = true; document.getElementById('routeCancelBtn').style.display = 'block';
    document.getElementById('routeId').value = id; document.getElementById('routeName').value = name; document.getElementById('routeDesc').value = desc;
}

function resetRouteForm() { 
    isEditingRoute = false; 
    document.getElementById('routeForm').reset(); 
    document.getElementById('routeId').value = ''; 
    document.getElementById('routeCancelBtn').style.display = 'none'; 
}

async function deleteRoute(id) { 
    if(confirm('تأكيد الحذف؟')) { 
        await fetch(`/api/routes/${id}`, { method: 'DELETE' }); 
        fetchRoutes(); 
    } 
}

// ==========================================
// شاشة المراقبة العامة للباصات (Global Fleet Monitoring) - محرك الفلترة الذكي
// ==========================================
let globalMonitoringMap = null;
let monitoringMarkers = {}; 
let globalFleetData = []; // تخزين مؤقت لبيانات الأسطول للفلترة الفورية

function initGlobalMonitoringMap() {
    if (!globalMonitoringMap) {
        globalMonitoringMap = L.map('globalMonitoringMapDiv').setView([31.95, 35.91], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(globalMonitoringMap);
    } else {
        globalMonitoringMap.invalidateSize();
    }
    fetchActiveFleetData();
}

async function fetchActiveFleetData() {
    try {
        const res = await fetch('/api/trips'); 
        globalFleetData = await res.json();
        
        // التعبئة التلقائية لقائمة المسارات في شريط الفلترة
        const routeFilter = document.getElementById('monitorRouteFilter');
        if (routeFilter && routeFilter.options.length <= 1) {
            const uniqueRoutes = [...new Set(globalFleetData.map(t => t.route_name))];
            uniqueRoutes.forEach(r => {
                if (r) routeFilter.innerHTML += `<option value="${r}">${r}</option>`;
            });
        }
        
        // استدعاء دالة الفرز لرسم القائمة
        filterLiveFleet();
    } catch(err) { console.error("خطأ في تحديث الأسطول العام:", err); }
}

// الفلترة اللحظية الذكية وعرض البطاقات
function filterLiveFleet() {
    const statusF = document.getElementById('monitorStatusFilter').value;
    const routeF = document.getElementById('monitorRouteFilter').value;
    const sidebarList = document.getElementById('globalFleetList');
    const countDisplay = document.getElementById('fleetCount');
    if(!sidebarList) return;

    let filtered = globalFleetData;

    // الفلترة حسب الحالة
    if (statusF !== 'all') {
        if (statusF === 'stopped') {
            filtered = filtered.filter(t => t.status === 'completed' || t.status === 'cancelled');
        } else {
            filtered = filtered.filter(t => t.status === statusF);
        }
    }
    
    // الفلترة حسب المسار
    if (routeF !== 'all') {
        filtered = filtered.filter(t => t.route_name === routeF);
    }

    countDisplay.innerText = filtered.length;

    if (filtered.length === 0) {
        sidebarList.innerHTML = '<div style="text-align:center; padding:30px; color:#777; font-size:14px;">لا توجد حافلات تطابق خيارات التصفية الحالية</div>';
        return;
    }

    // تصميم بطاقات الحافلات الاحترافي
    sidebarList.innerHTML = filtered.map(t => {
        let badgeColor = t.status === 'active' ? '#28a745' : t.status === 'pending' ? '#ffc107' : '#dc3545';
        let statusText = t.status === 'active' ? '🟢 سائر الآن' : t.status === 'pending' ? '⏳ مجدولة' : '🛑 متوقفة';
        
        return `
            <div style="padding: 15px; margin-bottom: 12px; background: white; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.04); cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='#007bff'" onmouseout="this.style.borderColor='#e0e0e0'" onclick="focusOnBus(${t.id})">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="font-size: 15px; color: #2c3e50;">باص: ${t.bus_plate}</strong> 
                    <span style="font-size: 12px; background: ${badgeColor}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${statusText}</span>
                </div>
                <div style="font-size: 13px; color: #555; margin-bottom: 4px;">👤 <b>السائق:</b> ${t.driver_name}</div>
                <div style="font-size: 13px; color: #555;">🗺️ <b>المسار:</b> ${t.route_name}</div>
            </div>
        `;
    }).join('');
}

function focusOnBus(tripId) {
    alert("سيتم التركيز على الخريطة للحافلة رقم الرحلة: " + tripId);
}

socket.on('busLocationUpdated', (data) => {
    console.log("تحديث موقع باص على الشاشة العامة:", data);
});

// ==========================================
// إعدادات المؤسسة (تتضمن معالجة الصور Base64)
// ==========================================

// دالة معاينة الصورة وتحويلها إلى Base64
function previewLogo(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64String = e.target.result;
            document.getElementById('settingLogoBase64').value = base64String;
            const preview = document.getElementById('logoPreview');
            preview.src = base64String;
            preview.style.display = 'inline-block';
        };
        reader.readAsDataURL(file);
    }
}

async function fetchSettings() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error('فشل في استرجاع الإعدادات');
        const settings = await res.json();
        if (settings.company_name) {
            document.getElementById('settingCompanyName').value = settings.company_name || '';
            document.getElementById('settingPhone').value = settings.contact_phone || '';
            document.getElementById('settingEmail').value = settings.contact_email || '';
            document.getElementById('settingAddress').value = settings.address || '';
            
            if (settings.logo_url) {
                document.getElementById('settingLogoBase64').value = settings.logo_url;
                const preview = document.getElementById('logoPreview');
                preview.src = settings.logo_url;
                preview.style.display = 'inline-block';
            }
        }
    } catch (err) { console.error('خطأ في جلب إعدادات المؤسسة:', err); }
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        company_name: document.getElementById('settingCompanyName').value,
        logo_url: document.getElementById('settingLogoBase64').value, // إرسال النص المحول
        contact_phone: document.getElementById('settingPhone').value,
        contact_email: document.getElementById('settingEmail').value,
        address: document.getElementById('settingAddress').value
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (res.ok) { alert('تم حفظ إعدادات المؤسسة بنجاح ✅'); } 
        else { alert('خطأ أثناء الحفظ: ' + result.error); }
    } catch (err) { alert('حدث خطأ في الاتصال بالسيرفر.'); }
});

// دمج جلب الإعدادات مع دالة فتح الأقسام
const originalShowSection = showSection;
showSection = function(sectionId) {
    originalShowSection(sectionId);
    if(sectionId === 'settings') { fetchSettings(); }
};


// بدء التشغيل
fetchTrips();
loadTripDropdowns();