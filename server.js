const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
require('dotenv').config();

const db = require('./db');

const app = express();
// السماح بالوصول للملفات الثابتة في المجلد الرئيسي
app.use(express.static(__dirname));
const server = http.createServer(app);

// إعداد خادم الـ WebSockets للسماح بالاتصال من أي مصدر (CORS)
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
// السماح للسيرفر بفهم البيانات المرسلة بصيغة JSON
app.use(express.json());
// جعل مجلد public متاحاً للعامة (يحتوي على ملفات التصميم css والسكربت js)
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// --- استدعاء المسارات المنفصلة (Routes) ---
// ==========================================
// يتم توجيه أي طلب يبدأ بـ /api/users إلى ملف المستخدمين المنفصل
const usersRouter = require('./routes/users');
app.use('/api/users', usersRouter); 

const busesRouter = require('./routes/buses');
app.use('/api/buses', busesRouter);

const routesRouter = require('./routes/routes');
app.use('/api/routes', routesRouter);

const stopsRouter = require('./routes/stops');
app.use('/api/stops', stopsRouter);

const tripsRouter = require('./routes/trips');
app.use('/api/trips', tripsRouter);

// ==========================================
// --- [جديد] مسار تسجيل الدخول الموحد ---
// ==========================================
// هذا المسار يستقبل بيانات الدخول من شاشة login.html
app.post('/api/login', async (req, res) => {
    // استخراج اسم المستخدم (الذي قد يكون الاسم، الهاتف، أو الإيميل) وكلمة المرور
    const { username, password } = req.body;
    
    try {
        // استعلام قاعدة البيانات:
        // نبحث عن المستخدم الذي يتطابق إما مع الهاتف، أو الاسم، أو الإيميل
        // ملاحظة: إذا كان الإيميل في القاعدة null، فلن يتم التطابق ولن يحدث خطأ
        const result = await db.query(
            `SELECT id, full_name, role, is_active 
             FROM users 
             WHERE (phone = $1 OR full_name = $1 OR email = $1) 
             AND password_hash = $2 
             AND is_active = true`,
            [username, password]
        );

        // إذا تم العثور على مستخدم يطابق الشروط
        if (result.rows.length > 0) {
            res.json(result.rows[0]); // إرسال بيانات المستخدم والصلاحية للواجهة
        } else {
            // إذا لم يتطابق، نرسل خطأ 401 (غير مصرح)
            res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }
    } catch (err) {
        console.error('خطأ في مسار تسجيل الدخول:', err);
        res.status(500).json({ error: 'خطأ داخلي في الخادم' });
    }
});

// ==========================================
// --- جلب كل رحلات السائق المستقبلية والمجدولة ---
// ==========================================
app.get('/api/trips/driver/:id/today', async (req, res) => {
    const driverId = req.params.id;
    try {
        // تم تصحيح اسم الجدول إلى bus_routes بدلاً من routes
        const result = await db.query(
            `SELECT t.id, t.route_id, r.route_name as route_name, b.plate_number as bus_plate, t.status, t.scheduled_time 
             FROM trips t
             JOIN bus_routes r ON t.route_id = r.id
             JOIN buses b ON t.bus_id = b.id
             WHERE t.driver_id = $1 
             ORDER BY t.scheduled_time ASC`,
            [driverId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('خطأ في استعلام السائق:', err);
        res.status(500).json({ error: 'خطأ في جلب جدول الرحلات' });
    }
});

// ==========================================
// --- [جديد] جلب المسارات والحافلات النشطة حسب فئة الراكب ---
// ==========================================
app.get('/api/passenger/routes', async (req, res) => {
    const audience = req.query.audience; // 'student' أو 'employee' أو 'all'
    try {
        let query = `
            SELECT r.id as route_id, r.route_name, r.description, r.target_audience,
                   t.id as trip_id, t.status, t.scheduled_time, b.plate_number as bus_plate, b.capacity,
                   u.full_name as driver_name, u.phone as driver_phone
            FROM bus_routes r
            JOIN trips t ON r.id = t.route_id
            JOIN buses b ON t.bus_id = b.id
            JOIN users u ON t.driver_id = u.id
            WHERE t.status IN ('pending', 'active')
        `;
        
        let queryParams = [];
        // إذا كان الراكب طالباً، نُظهر له مسارات الطلاب والـ all فقط
        if (audience === 'student') {
            query += ` AND r.target_audience IN ('student', 'all')`;
        } 
        // إذا كان موظفاً، يرى مسارات الموظفين والطلاب والـ all
        else if (audience === 'employee') {
            query += ` AND r.target_audience IN ('employee', 'student', 'all')`;
        }
        // الـ admin أو غيره يرى الكل

        query += ` ORDER BY t.scheduled_time ASC`;

        const result = await db.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('خطأ في جلب مسارات الركاب:', err);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// ==========================================
// --- [تعديل] مسار تحديث حالة الرحلة ليقبل الملاحظات ---
// ==========================================
app.patch('/api/trips/:id/status-with-notes', async (req, res) => {
    const tripId = req.params.id;
    const { status, start_notes } = req.body;
    try {
        if (start_notes) {
            await db.query(`UPDATE trips SET status = $1, start_notes = $2 WHERE id = $3`, [status, start_notes, tripId]);
        } else {
            await db.query(`UPDATE trips SET status = $1 WHERE id = $3`, [status, tripId]);
        }
        res.json({ message: 'تم تحديث الحالة بنجاح' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في تحديث الرحلة' });
    }
});

// ==========================================
// --- مسارات شاشات الواجهة الأمامية ---
// ==========================================
app.get('/', (req, res) => res.send('Bus Tracking Server is Running!'));
// سيتم لاحقاً إضافة app.get('/login') لتوجيه المستخدمين بشكل افتراضي
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'driver.html')));
app.get('/passenger', (req, res) => res.sendFile(path.join(__dirname, 'passenger.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ==========================================
// --- قسم البث اللحظي للـ WebSockets ---
// ==========================================
io.on('connection', (socket) => {
    console.log('مستخدم جديد متصل:', socket.id);

    // استلام موقع الباص من السائق وإعادة توجيهه للركاب
    socket.on('updateBusLocation', (data) => {
        io.emit('busLocationUpdate', data);
    });

    // استلام تنبيه الراكب وإرساله للسائق
    socket.on('passengerAlert', (data) => {
        io.emit('driverPassengerAlert', data);
    });

    // إلغاء تنبيه الراكب
    socket.on('passengerCancelAlert', (data) => {
        io.emit('driverCancelPassengerAlert', data);
    });

    // استلام تنبيه من الإدارة لإرساله لسائق محدد
    socket.on('adminSendAlert', (data) => {
        console.log(`⚠️ تنبيه من الإدارة للسائق ${data.driverId}: ${data.message}`);
        io.emit(`alertToDriver_${data.driverId}`, {
            message: data.message,
            timestamp: new Date()
        });
    });

    socket.on('disconnect', () => {
        console.log('مستخدم غادر:', socket.id);
    });
});

// ==========================================
// --- تشغيل السيرفر ---
// ==========================================
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});