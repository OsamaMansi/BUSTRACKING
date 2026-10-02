const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
require('dotenv').config();

const db = require('./db');

const app = express();
app.use(express.static(__dirname));
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('public')); // يقرأ تلقائياً مجلد public ويوفر مجلدات css و js بداخله

// ==========================================
// --- استدعاء المسارات المنفصلة (Routes) ---
// ==========================================
const usersRouter = require('./routes/users');
app.use('/api/users', usersRouter); // أي طلب يبدأ بـ /api/users سيتم توجيهه للملف المنفصل

const busesRouter = require('./routes/buses');
app.use('/api/buses', busesRouter);

const routesRouter = require('./routes/routes');
app.use('/api/routes', routesRouter);

const stopsRouter = require('./routes/stops');
app.use('/api/stops', stopsRouter);

const tripsRouter = require('./routes/trips');
app.use('/api/trips', tripsRouter);

// ==========================================
// --- مسارات شاشات الواجهة الأمامية ---
// ==========================================
app.get('/', (req, res) => res.send('Bus Tracking Server is Running!'));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'driver.html')));
app.get('/passenger', (req, res) => res.sendFile(path.join(__dirname, 'passenger.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ==========================================
// --- قسم البث اللحظي للـ WebSockets ---
// ==========================================
// ==========================================
// إعدادات الـ Socket.io (الاتصال اللحظي)
// ==========================================
io.on('connection', (socket) => {
    console.log('مستخدم جديد متصل:', socket.id);

// استلام موقع الباص من السائق وإعادة توجيهه للركاب
    socket.on('updateBusLocation', (data) => {
        // data: { routeId, lat, lng, driverId }
        io.emit('busLocationUpdate', data);
    });

    // استلام تنبيه الراكب وإرساله للسائق
    socket.on('passengerAlert', (data) => {
        // data: { routeId, message }
        io.emit('driverPassengerAlert', data);
    });

    // إلغاء تنبيه الراكب
    socket.on('passengerCancelAlert', (data) => {
        io.emit('driverCancelPassengerAlert', data);
    });

    // استلام تنبيه من الإدارة لإرساله لسائق محدد (الكود الجديد داخل القوس الصحيح)
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
// تشغيل السيرفر
// ==========================================
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});