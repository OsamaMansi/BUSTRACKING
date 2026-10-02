const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. جلب المحطات (مرتبة حسب stop_order)
router.get('/:routeId', async (req, res) => {
    try {
        const { routeId } = req.params;
        const result = await db.query(
            'SELECT * FROM route_stops WHERE route_id = $1 ORDER BY stop_order ASC, id ASC', 
            [routeId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب المحطات' });
    }
});

// 2. إضافة محطة مع "إزاحة" المحطات اللاحقة (Shift Down)
router.post('/', async (req, res) => {
    const { route_id, stop_name, latitude, longitude, dwell_time_minutes, stop_order } = req.body;
    const targetOrder = parseInt(stop_order) || 1;

    try {
        await db.query('BEGIN'); // بدء المعاملة لضمان سلامة الترتيب
        
        // إزاحة جميع المحطات التي لها نفس الترتيب أو أكبر بمقدار +1
        await db.query(
            'UPDATE route_stops SET stop_order = stop_order + 1 WHERE route_id = $1 AND stop_order >= $2',
            [route_id, targetOrder]
        );

        // إدراج المحطة الجديدة في الفراغ الذي صنعناه
        const result = await db.query(
            'INSERT INTO route_stops (route_id, stop_name, latitude, longitude, dwell_time_minutes, stop_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [route_id, stop_name, latitude, longitude, dwell_time_minutes, targetOrder]
        );
        
        await db.query('COMMIT');
        res.json({ success: true, stop: result.rows[0] });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error("خطأ في إضافة المحطة:", err.message);
        res.status(500).json({ error: 'خطأ في حفظ المحطة' });
    }
});

// 3. تعديل المحطة (مع خوارزمية ذكية لإعادة الترتيب)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { stop_name, latitude, longitude, dwell_time_minutes, stop_order } = req.body;
    const newOrder = parseInt(stop_order) || 1;

    try {
        await db.query('BEGIN');

        // جلب الترتيب القديم للمحطة
        const currentStop = await db.query('SELECT route_id, stop_order FROM route_stops WHERE id = $1', [id]);
        if (currentStop.rows.length === 0) throw new Error('المحطة غير موجودة');
        
        const oldOrder = currentStop.rows[0].stop_order;
        const route_id = currentStop.rows[0].route_id;

        // إذا تم تغيير الترتيب، نقوم بالإزاحة المناسبة
        if (newOrder < oldOrder) {
            // سحب المحطة للأعلى: إزاحة المحطات المحصورة للأسفل (+1)
            await db.query(
                'UPDATE route_stops SET stop_order = stop_order + 1 WHERE route_id = $1 AND stop_order >= $2 AND stop_order < $3',
                [route_id, newOrder, oldOrder]
            );
        } else if (newOrder > oldOrder) {
            // دفع المحطة للأسفل: إزاحة المحطات المحصورة للأعلى (-1)
            await db.query(
                'UPDATE route_stops SET stop_order = stop_order - 1 WHERE route_id = $1 AND stop_order <= $2 AND stop_order > $3',
                [route_id, newOrder, oldOrder]
            );
        }

        // تحديث بيانات المحطة الحالية
        await db.query(
            'UPDATE route_stops SET stop_name = $1, latitude = $2, longitude = $3, dwell_time_minutes = $4, stop_order = $5 WHERE id = $6',
            [stop_name, latitude, longitude, dwell_time_minutes, newOrder, id]
        );

        await db.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error("خطأ في التعديل:", err.message);
        res.status(500).json({ error: 'خطأ في تحديث المحطة' });
    }
});

// 4. حذف محطة
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM route_stops WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في الحذف' });
    }
});

module.exports = router;