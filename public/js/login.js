document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // المستخدم سيدخل رقم هاتفه هنا (أو إيميله للإدارة)
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('errorMessage');
    
    errorMsg.style.display = 'none';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const user = await response.json();
            
            // حفظ بيانات المستخدم لاستخدامها في الشاشات (مثل إخفاء قائمة اختيار السائق)
            localStorage.setItem('currentUser', JSON.stringify(user));

            // التوجيه الذكي حسب عمود (role) من قاعدة البيانات
            if (user.role === 'admin') {
                window.location.href = '/admin.html';
            } else if (user.role === 'driver') {
                window.location.href = '/driver.html';
            } else if (user.role === 'passenger') {
                window.location.href = '/passenger.html';
            } else {
                errorMsg.innerText = "صلاحية غير مدعومة حالياً.";
                errorMsg.style.display = 'block';
            }
        } else {
            errorMsg.innerText = "رقم الهاتف أو كلمة المرور غير صحيحة.";
            errorMsg.style.display = 'block';
        }
    } catch (error) {
        console.error('خطأ في الاتصال:', error);
        errorMsg.innerText = "حدث خطأ في الاتصال بالخادم.";
        errorMsg.style.display = 'block';
    }
});