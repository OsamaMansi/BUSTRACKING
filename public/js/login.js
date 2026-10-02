// الاستماع لحدث الضغط على زر "تسجيل الدخول"
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); // منع المتصفح من إعادة تحميل الصفحة
    
    // جلب البيانات التي أدخلها المستخدم وإزالة أي مسافات زائدة
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('errorMessage');
    
    errorMsg.style.display = 'none'; // إخفاء رسالة الخطأ عند كل محاولة جديدة

    try {
        // إرسال البيانات إلى السيرفر (مسار /api/login الذي جهزناه سابقاً)
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            // إذا تم التحقق بنجاح، نستلم بيانات المستخدم من قاعدة البيانات
            const user = await response.json();
            
            // حفظ بيانات المستخدم في المتصفح لاستخدامها في الشاشات الأخرى لاحقاً
            localStorage.setItem('currentUser', JSON.stringify(user));

            // التوجيه الذكي بناءً على الصلاحية (Role)
            if (user.role === 'admin') {
                window.location.href = '/admin.html';
            } else if (user.role === 'driver') {
                window.location.href = '/driver.html';
            } else if (user.role === 'passenger') {
                window.location.href = '/passenger.html';
            } else if (user.role === 'monitor') {
                window.location.href = '/fleet.html'; // شاشة المراقبة الشاملة
            } else {
                errorMsg.innerText = "لا تملك الصلاحية للدخول.";
                errorMsg.style.display = 'block';
            }
        } else {
            // في حال أعاد السيرفر حالة رفض (البيانات خاطئة)
            errorMsg.innerText = "الاسم، رقم الهاتف، أو كلمة المرور غير صحيحة.";
            errorMsg.style.display = 'block';
        }
    } catch (error) {
        console.error('خطأ في الاتصال:', error);
        errorMsg.innerText = "حدث خطأ في الاتصال بالسيرفر.";
        errorMsg.style.display = 'block';
    }
});