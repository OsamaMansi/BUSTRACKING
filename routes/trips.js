const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. جلب جميع الرحلات (للإدارة)
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT t.id, t.status, t.scheduled_time, t.driver_id, t.bus_id, t.route_id,
                   u.full_name AS driver_name, 
                   b.plate_number AS bus_plate, 
                   r.route_name 
            FROM trips t
            JOIN users u ON t.driver_id = u.id
            JOIN buses b ON t.bus_id = b.id
            JOIN bus_routes r ON t.route_id = r.id
            ORDER BY t.scheduled_time DESC
        `;
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error("خطأ في جلب الرحلات:", err.message);
        res.status(500).json({ error: 'خطأ في جلب الرحلات' });
    }
});

// 2. جلب رحلة السائق
router.get('/driver/:driverId', async (req, res) => {
    try {
        const { driverId } = req.params;
        const query = `
            SELECT t.id, t.status, t.scheduled_time, 
                   b.plate_number AS bus_plate, 
                   r.route_name, r.id AS route_id
            FROM trips t
            JOIN buses b ON t.bus_id = b.id
            JOIN bus_routes r ON t.route_id = r.id
            WHERE t.driver_id = $1 AND t.status IN ('pending', 'active')
            ORDER BY t.scheduled_time ASC LIMIT 1
        `;
        const result = await db.query(query, [driverId]);
        res.json(result.rows[0] || null);
    } catch (err) {
        console.error("خطأ في جلب رحلة السائق:", err.message);
        res.status(500).json({ error: 'خطأ في جلب رحلة السائق' });
    }
});

// دالة مساعدة لجلب جدول رحلات السائق الشهرية عند التعارض
async function getDriverMonthlySchedule(driver_id, scheduled_time) {
    const monthlyTrips = await db.query(
        `SELECT t.scheduled_time, r.route_name, b.plate_number, t.status
         FROM trips t
         JOIN bus_routes r ON t.route_id = r.id
         JOIN buses b ON t.bus_id = b.id
         WHERE t.driver_id = $1 
           AND EXTRACT(MONTH FROM t.scheduled_time) = EXTRACT(MONTH FROM $2::timestamp)
           AND EXTRACT(YEAR FROM t.scheduled_time) = EXTRACT(YEAR FROM $2::timestamp)
         ORDER BY t.scheduled_time ASC`,
        [driver_id, scheduled_time]
    );

    if (monthlyTrips.rows.length === 0) return 'لا توجد رحلات أخرى مسجلة لهذا السائق في هذا الشهر.';

    return monthlyTrips.rows.map((tr, index) => {
        const dateObj = new Date(tr.scheduled_time);
        const dateFormatted = dateObj.toLocaleDateString('ar-EG');
        const timeFormatted = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        const statusAr = tr.status === 'pending' ? 'مجدولة ⏳' : tr.status === 'active' ? 'جارية 🟢' : 'مكتملة ✔️';
        return `${index + 1}. التاريخ: ${dateFormatted} | الساعة: ${timeFormatted} | المسار: ${tr.route_name} | الباص: ${tr.plate_number} | الحالة: ${statusAr}`;
    }).join('\n');
}

// 3. تعيين رحلة جديدة (الحالة الافتراضية pending مع فحص تعارض ساعتين)
router.post('/', async (req, res) => {
    const { driver_id, bus_id, route_id, scheduled_time } = req.body;
    
    try {
        // فحص التعارض بفترة أقل من ساعتين باستخدام فترات PostgreSQL الدقيقة
        const conflictCheck = await db.query(
            `SELECT t.id, u.full_name, b.plate_number 
             FROM trips t
             JOIN users u ON t.driver_id = u.id
             JOIN buses b ON t.bus_id = b.id
             WHERE (t.driver_id = $1 OR t.bus_id = $2) 
               AND t.scheduled_time >= ($3::timestamp - INTERVAL '2 hours') 
               AND t.scheduled_time <= ($3::timestamp + INTERVAL '2 hours')`,
            [driver_id, bus_id, scheduled_time]
        );

        if (conflictCheck.rows.length > 0) {
            const conflict = conflictCheck.rows[0];
            const scheduleReport = await getDriverMonthlySchedule(driver_id, scheduled_time);
            
            return res.status(400).json({ 
                error: `⚠️ تنبيه تعارض تشغيلي (أقل من ساعتين):\nالسائق "${conflict.full_name}" أو الحافلة "${conflict.plate_number}" لديهما رحلة أخرى متداخلة في التوقيت!\n\n📅 تفاصيل جدول رحلات السائق الشهرية:\n${scheduleReport}` 
            });
        }

        const result = await db.query(
            'INSERT INTO trips (driver_id, bus_id, route_id, scheduled_time, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [driver_id, bus_id, route_id, scheduled_time, 'pending']
        );
        res.json({ success: true, message: 'تم تعيين الرحلة بنجاح كحالة مجدولة', trip: result.rows[0] });
    } catch (err) {
        console.error("خطأ قاعدة البيانات:", err.message);
        res.status(500).json({ error: 'خطأ قاعدة البيانات: ' + err.message });
    }
});

// 4. تعديل رحلة مع فحص دقيق للتعارض (فارق ساعتين) واستثناء الرحلة الحالية
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { driver_id, bus_id, route_id, scheduled_time } = req.body;

    try {
        const conflictCheck = await db.query(
            `SELECT t.id, u.full_name, b.plate_number 
             FROM trips t
             JOIN users u ON t.driver_id = u.id
             JOIN buses b ON t.bus_id = b.id
             WHERE (t.driver_id = $1 OR t.bus_id = $2) 
               AND t.scheduled_time >= ($3::timestamp - INTERVAL '2 hours') 
               AND t.scheduled_time <= ($3::timestamp + INTERVAL '2 hours')
               AND t.id != $4`,
            [driver_id, bus_id, scheduled_time, id]
        );

        if (conflictCheck.rows.length > 0) {
            const conflict = conflictCheck.rows[0];
            const scheduleReport = await getDriverMonthlySchedule(driver_id, scheduled_time);

            return res.status(400).json({ 
                error: `⚠️ لا يمكن التعديل - يوجد تعارض زمني (أقل من ساعتين):\nالسائق "${conflict.full_name}" أو الحافلة "${conflict.plate_number}" لديهما رحلة متداخلة في نفس التوقيت المتقارب.\n\n📅 تفاصيل جدول رحلات السائق الشهرية:\n${scheduleReport}` 
            });
        }

        const result = await db.query(
            'UPDATE trips SET driver_id = $1, bus_id = $2, route_id = $3, scheduled_time = $4 WHERE id = $5 RETURNING *',
            [driver_id, bus_id, route_id, scheduled_time, id]
        );
        res.json({ success: true, message: 'تم تحديث بيانات الرحلة بنجاح', trip: result.rows[0] });
    } catch (err) {
        console.error("خطأ في التعديل:", err.message);
        res.status(500).json({ error: 'خطأ في تحديث الرحلة: ' + err.message });
    }
});

// 5. ميزة نسخ رحلات الشهر الحالي إلى الشهر القادم
router.post('/copy-next-month', async (req, res) => {
    const { year, month } = req.body;
    try {
        const query = `
            INSERT INTO trips (driver_id, bus_id, route_id, scheduled_time, status)
            SELECT driver_id, bus_id, route_id, scheduled_time + INTERVAL '1 month', 'pending'
            FROM trips
            WHERE EXTRACT(MONTH FROM scheduled_time) = $1 
              AND EXTRACT(YEAR FROM scheduled_time) = $2
            RETURNING *;
        `;
        const result = await db.query(query, [month, year]);
        res.json({ success: true, message: `تم نسخ ${result.rows.length} رحلة إلى الشهر القادم بنجاح كحالة "مجدولة".`, count: result.rows.length });
    } catch (err) {
        console.error("خطأ في نسخ الرحلات:", err.message);
        res.status(500).json({ error: 'خطأ في نسخ رحلات الشهر: ' + err.message });
    }
});

// 6. حذف رحلة
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM trips WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'الرحلة غير موجودة' });
        }
        res.json({ success: true, message: 'تم حذف الرحلة بنجاح' });
    } catch (err) {
        console.error("خطأ في الحذف:", err.message);
        res.status(500).json({ error: 'خطأ في حذف الرحلة: ' + err.message });
    }
});

// 7. تغيير حالة الرحلة
router.patch('/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.query('UPDATE trips SET status = $1 WHERE id = $2', [status, id]);
        res.json({ success: true, message: `تم تغيير حالة الرحلة إلى ${status}` });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في تحديث حالة الرحلة' });
    }
});

module.exports = router;