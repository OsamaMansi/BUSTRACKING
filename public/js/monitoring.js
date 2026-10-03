const socket = io();
let globalMonitoringMap = null;
let monitoringMarkers = {}; 
let globalFleetData = []; 

function logout() { localStorage.removeItem('currentUser'); window.location.href = '/login.html'; }

window.addEventListener('DOMContentLoaded', () => { initGlobalMonitoringMap(); });

function initGlobalMonitoringMap() {
    globalMonitoringMap = L.map('globalMonitoringMapDiv').setView([31.95, 35.91], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(globalMonitoringMap);
    fetchActiveFleetData();
}

async function fetchActiveFleetData() {
    try {
        const res = await fetch('/api/trips'); 
        globalFleetData = await res.json();
        
        const routeFilter = document.getElementById('monitorRouteFilter');
        if (routeFilter && routeFilter.options.length <= 1) {
            const uniqueRoutes = [...new Set(globalFleetData.map(t => t.route_name))];
            uniqueRoutes.forEach(r => { if (r) routeFilter.innerHTML += `<option value="${r}">${r}</option>`; });
        }
        filterLiveFleet();
    } catch(err) { console.error("خطأ:", err); }
}

function filterLiveFleet() {
    const statusF = document.getElementById('monitorStatusFilter').value;
    const routeF = document.getElementById('monitorRouteFilter').value;
    const sidebarList = document.getElementById('globalFleetList');
    
    let filtered = globalFleetData;
    if (statusF !== 'all') {
        filtered = statusF === 'stopped' ? filtered.filter(t => t.status === 'completed' || t.status === 'cancelled') : filtered.filter(t => t.status === statusF);
    }
    if (routeF !== 'all') filtered = filtered.filter(t => t.route_name === routeF);

    document.getElementById('fleetCount').innerText = filtered.length;

    if (filtered.length === 0) {
        sidebarList.innerHTML = '<div style="text-align:center; padding:30px; color:#777;">لا توجد حافلات تطابق الخيارات</div>';
        return;
    }

    sidebarList.innerHTML = filtered.map(t => {
        let badgeColor = t.status === 'active' ? '#28a745' : t.status === 'pending' ? '#ffc107' : '#dc3545';
        let statusText = t.status === 'active' ? '🟢 جارية' : t.status === 'pending' ? '⏳ مجدولة' : '🛑 متوقفة';
        return `
            <div style="padding: 15px; margin-bottom: 12px; background: white; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.04); cursor: pointer;" onclick="focusOnBus(${t.id})">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <strong style="color: #2c3e50;">باص: ${t.bus_plate}</strong> 
                    <span style="font-size: 11px; background: ${badgeColor}; color: white; padding: 3px 6px; border-radius: 4px;">${statusText}</span>
                </div>
                <div style="font-size: 12px; color: #555;">👤 السائق: ${t.driver_name}</div>
                <div style="font-size: 12px; color: #555;">🗺️ المسار: ${t.route_name}</div>
            </div>`;
    }).join('');
}

function focusOnBus(tripId) { alert("سيتم التركيز على החافلة رقم: " + tripId); }

// رسم الحافلة لحظياً على الخريطة
socket.on('busLocationUpdated', (data) => {
    const { routeId, lat, lng, driverId } = data;
    if (!monitoringMarkers[driverId]) {
        monitoringMarkers[driverId] = L.marker([lat, lng], {
            icon: L.divIcon({ className: 'bus-icon', html: '🚌', iconSize: [30, 30] })
        }).addTo(globalMonitoringMap).bindPopup('حافلة نشطة');
    } else {
        monitoringMarkers[driverId].setLatLng([lat, lng]);
    }
});