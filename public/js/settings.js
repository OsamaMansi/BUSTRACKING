function logout() { localStorage.removeItem('currentUser'); window.location.href = '/login.html'; }

window.addEventListener('DOMContentLoaded', fetchSettings);

function previewLogo(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('settingLogoBase64').value = e.target.result;
            const preview = document.getElementById('logoPreview');
            preview.src = e.target.result;
            preview.style.display = 'inline-block';
        };
        reader.readAsDataURL(file);
    }
}

async function fetchSettings() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
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
    } catch (err) { console.error('خطأ:', err); }
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        company_name: document.getElementById('settingCompanyName').value,
        logo_url: document.getElementById('settingLogoBase64').value,
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
        if (res.ok) { alert('تم حفظ الإعدادات بنجاح ✅'); } 
        else { alert('خطأ أثناء الحفظ'); }
    } catch (err) { alert('خطأ بالاتصال بالسيرفر'); }
});