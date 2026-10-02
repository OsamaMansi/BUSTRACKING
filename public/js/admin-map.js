let currentRouteId = null, currentRouteName = '', currentRouteDesc = '', mapModalInstance = null, selectedLatLng = null, tempMarker = null;
let stopMarkersGroup = L.layerGroup(); 
let routingControl = null; 

// 1. فتح نافذة الخريطة
window.openMapModal = function(routeId, routeName, routeDesc, deviationMeters) {
    currentRouteId = routeId; currentRouteName = routeName; currentRouteDesc = routeDesc;
    document.getElementById('modalRouteTitle').innerText = `إدارة مسار: ${routeName}`;
    document.getElementById('routeDeviationInput').value = deviationMeters || 100;
    
    document.getElementById('mapModal').style.display = 'flex';

    setTimeout(() => {
        if (!mapModalInstance) {
            mapModalInstance = L.map('mapContainer').setView([31.95, 35.91], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapModalInstance);
            stopMarkersGroup.addTo(mapModalInstance);
            mapModalInstance.on('click', (e) => {
                selectedLatLng = e.latlng;
                if (tempMarker) tempMarker.setLatLng(selectedLatLng);
                else tempMarker = L.marker(selectedLatLng, {draggable: true}).addTo(mapModalInstance);
                tempMarker.bindPopup('📍 موقع المحطة المحددة (اضغط ➕ إضافة بالنقر لحفظها)').openPopup();
            });
        } else { mapModalInstance.invalidateSize(); }
        loadRouteStops(routeId);
    }, 200);
};

// 2. إغلاق النافذة
window.closeMapModal = function() {
    document.getElementById('mapModal').style.display = 'none';
    selectedLatLng = null;
    if(tempMarker) { mapModalInstance.removeLayer(tempMarker); tempMarker = null; }
};

// 3. تحميل المحطات ورسم الخطوط
async function loadRouteStops(routeId) {
    stopMarkersGroup.clearLayers();
    
    if (routingControl) { 
        mapModalInstance.removeControl(routingControl); 
        routingControl = null; 
    }

    const res = await fetch(`/api/stops/${routeId}`);
    const stops = await res.json();
    const waypoints = [];
    
    // الحل الجذري: تحديد الترتيب التالي تلقائياً ليكون في نهاية المسار
    if (stops.length > 0) {
        const maxOrder = Math.max(...stops.map(s => parseInt(s.stop_order) || 0));
        document.getElementById('stopOrderInput').value = maxOrder + 1;
    } else {
        document.getElementById('stopOrderInput').value = 1;
    }

    stops.forEach((stop) => {
        const latLng = L.latLng(stop.latitude, stop.longitude);
        waypoints.push(latLng);
        
        const marker = L.marker(latLng, { draggable: true }).addTo(stopMarkersGroup);
        marker.bindPopup(`
            <div style="text-align:right;">
                <b>🚏 محطة [${stop.stop_order}]: ${stop.stop_name}</b><br>
                ⏳ انتظار: ${stop.dwell_time_minutes} دقيقة<br>
                <div style="margin-top: 10px; display: flex; gap: 5px; justify-content: flex-end;">
                    <button onclick="editStop(${stop.id}, '${stop.stop_name}', ${stop.dwell_time_minutes}, ${stop.stop_order}, ${stop.latitude}, ${stop.longitude})" style="background:#ffc107; color:black; border:none; padding:5px 10px; border-radius: 3px; cursor: pointer;">تعديل</button>
                    <button onclick="deleteStop(${stop.id})" style="background:#dc3545; color:white; border:none; padding:5px 10px; border-radius: 3px; cursor: pointer;">حذف</button>
                </div>
            </div>
        `);

        marker.on('dragend', async function(e) {
            if(confirm(`حفظ الموقع الجديد لمحطة "${stop.stop_name}"؟`)) {
                await fetch(`/api/stops/${stop.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stop_name: stop.stop_name, latitude: marker.getLatLng().lat, longitude: marker.getLatLng().lng, dwell_time_minutes: stop.dwell_time_minutes, stop_order: stop.stop_order }) });
                loadRouteStops(currentRouteId);
            } else { marker.setLatLng(latLng); }
        });
    });

    if (waypoints.length > 1) {
        let isFirstLoad = true; 

        routingControl = L.Routing.control({
            waypoints: waypoints,
            routeWhileDragging: false, 
            addWaypoints: false, 
            draggableWaypoints: false, 
            show: false, 
            createMarker: function() { return null; }, 
            lineOptions: { styles: [{ color: '#007bff', opacity: 0.8, weight: 6 }] },
            router: L.Routing.osrmv1({
                serviceUrl: 'https://routing.openstreetmap.de/routed-car/route/v1'
            })
        }).addTo(mapModalInstance);

        routingControl.on('routesfound', function(e) {
            if (isFirstLoad) {
                mapModalInstance.fitBounds(L.latLngBounds(e.routes[0].coordinates), { padding: [30, 30] });
                isFirstLoad = false; 
            }
        });
        
        routingControl.on('routingerror', function(e) {
            console.error('فشل في رسم الخطوط:', e);
        });

    } else if (waypoints.length === 1) { 
        mapModalInstance.setView(waypoints[0], 15); 
    } 
}

// 4. حفظ محطة جديدة
window.saveStop = async function() {
    const stopName = document.getElementById('stopNameInput').value;
    const dwellTime = document.getElementById('dwellTimeInput').value;
    const stopOrder = document.getElementById('stopOrderInput').value;

    if(!stopName || !selectedLatLng) return alert('أدخل الاسم وحدد الموقع بالنقر على الخريطة');

    const res = await fetch('/api/stops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route_id: currentRouteId, stop_name: stopName, latitude: selectedLatLng.lat, longitude: selectedLatLng.lng, dwell_time_minutes: dwellTime, stop_order: stopOrder }) });
    if(res.ok) {
        document.getElementById('stopNameInput').value = '';
        if(tempMarker) { mapModalInstance.removeLayer(tempMarker); tempMarker = null; }
        selectedLatLng = null; 
        loadRouteStops(currentRouteId);
    }
};

// 5. دالة تعديل معلومات المحطة
window.editStop = async function(stopId, currentName, currentDwell, currentOrder, lat, lng) {
    const newName = prompt("أدخل اسم المحطة الجديد:", currentName);
    if (newName === null) return; 
    
    const newOrderStr = prompt("أدخل ترتيب المحطة (سيقوم النظام بإزاحة باقي المحطات تلقائياً):", currentOrder);
    if (newOrderStr === null) return;
    const newOrder = parseInt(newOrderStr) || 1;

    const newDwellStr = prompt("أدخل وقت الانتظار الجديد (بالدقائق):", currentDwell);
    if (newDwellStr === null) return;
    const newDwell = parseInt(newDwellStr);
    
    if (isNaN(newDwell) || newDwell < 0) return alert("وقت الانتظار غير صحيح.");

    try {
        const res = await fetch(`/api/stops/${stopId}`, { 
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ stop_name: newName, dwell_time_minutes: newDwell, stop_order: newOrder, latitude: lat, longitude: lng }) 
        });
        
        if (res.ok) {
            alert("تم تعديل المحطة وإعادة ترتيب المسارات بنجاح");
            loadRouteStops(currentRouteId);
        } else {
            alert("حدث خطأ أثناء التعديل.");
        }
    } catch (err) {
        console.error(err);
        alert("حدث خطأ في الاتصال.");
    }
};

// 6. حذف محطة
window.deleteStop = async function(stopId) {
    if(confirm('حذف المحطة وإعادة رسم الخط؟')) {
        await fetch(`/api/stops/${stopId}`, { method: 'DELETE' }); loadRouteStops(currentRouteId);
    }
};

// 7. تحديث السماحية
window.updateRouteDeviation = async function() {
    const deviation = document.getElementById('routeDeviationInput').value;
    const res = await fetch(`/api/routes/${currentRouteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route_name: currentRouteName, description: currentRouteDesc, allowed_deviation_meters: deviation }) });
    if(res.ok) { alert('تم الحفظ'); fetchRoutes(); }
};