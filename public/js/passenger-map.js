const socket = io(); 

// إعداد الخريطة المبدئية
const map = L.map('map').setView([31.99, 35.95], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

let busMarker = null;
let isNotified = false; // متغير لمنع تكرار صوت/رسالة التنبيه باستمرار

// 1. تحديد إحداثيات محطة انتظار الراكب (استخدمنا الإحداثيات التي ظهرت في جهازك سابقاً)
const myStopLatLng = [31.99, 35.95]; 

// 2. رسم دائرة وهمية (السياج الجغرافي) بقطر 500 متر حول المحطة
const stopCircle = L.circle(myStopLatLng, {
    color: 'blue',
    fillColor: '#30f',
    fillOpacity: 0.1,
    radius: 500 
}).addTo(map).bindPopup('🚏 محطتي');


socket.on('connect', () => {
    document.getElementById('status').innerText = 'Connected 🟢';
    document.getElementById('status').style.color = 'green';
});

socket.on('busLocationChanged', (data) => {
    document.getElementById('busLocation').innerText = 
        `Lat: ${data.latitude.toFixed(4)} | Lng: ${data.longitude.toFixed(4)} | Speed: ${data.speed} km/h`;

    const newLatLng = [data.latitude, data.longitude];

    // تحريك علامة الباص
    if (!busMarker) {
        busMarker = L.marker(newLatLng).addTo(map).bindPopup('<b>🚌 الباص</b>').openPopup();
    } else {
        busMarker.setLatLng(newLatLng);
    }
    
    // تتبع الباص في منتصف الشاشة
    map.panTo(newLatLng);

    // -----------------------------------------------------
    // 3. حساب المسافة بين الباص والمحطة (بالمتر)
    // -----------------------------------------------------
    const currentBusLocation = L.latLng(data.latitude, data.longitude);
    const stopLocation = L.latLng(myStopLatLng[0], myStopLatLng[1]);
    
    // دالة distanceTo مدمجة في مكتبة Leaflet وتحسب المسافة الدقيقة
    const distance = currentBusLocation.distanceTo(stopLocation); 

    // إذا كانت المسافة أقل من أو تساوي 500 متر ولم يتم تنبيه الراكب بعد
    if (distance <= 500 && !isNotified) {
        // يمكنك لاحقاً استبدال هذا التنبيه بصوت أو إشعار احترافي
        alert(`🚌 تنبيه: الباص يقترب من محطتك! المسافة الحالية: ${Math.round(distance)} متر.`);
        isNotified = true; // تسجيل أنه تم التنبيه لمنع الإزعاج
    } 
    // إذا ابتعد الباص، نعيد ضبط التنبيه ليعمل في الرحلة القادمة
    else if (distance > 500) {
        isNotified = false;
    }
});

socket.on('disconnect', () => {
    document.getElementById('status').innerText = 'Disconnected 🔴';
    document.getElementById('status').style.color = 'red';
});