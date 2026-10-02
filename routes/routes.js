const express = require('express');
const router = express.Router();
const db = require('../db');

// جلب جميع المسارات مع محطاتها وتفاصيلها
router.get('/', async (req, res) => {
    try {
        const routesQuery = await db.query('SELECT * FROM bus_routes ORDER BY id DESC');
        const routes = routesQuery.rows;

        // جلب المحطات لكل مسار لتقديم بنية متكاملة
        for (let route of routes) {
            const stopsQuery = await db.query(
                'SELECT * FROM route_stops WHERE route_id = $1 ORDER BY stop_order ASC',
                [route.id]
            );
            route.stops = stopsQuery.rows;
        }

        res.json(routes);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب المسارات' });
    }
});

// إضافة مسار جديد مع إعدادات السياج الجغرافي
router.post('/', async (req, res) => {
    const { route_name, description, allowed_deviation_meters } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO bus_routes (route_name, description, allowed_deviation_meters) VALUES ($1, $2, $3) RETURNING *',
            [route_name, description, allowed_deviation_meters || 100] // السماحية الافتراضية 100 متر عن المسار
        );
        res.json({ success: true, route: result.rows[0], message: 'تم إنشاء المسار بنجاح' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في إضافة المسار' });
    }
});

// تعديل بيانات المسار
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { route_name, description, allowed_deviation_meters } = req.body;
    try {
        await db.query(
            'UPDATE bus_routes SET route_name = $1, description = $2, allowed_deviation_meters = $3 WHERE id = $4',
            [route_name, description, allowed_deviation_meters, id]
        );
        res.json({ success: true, message: 'تم تحديث المسار بنجاح' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في تحديث المسار' });
    }
});

// حذف مسار
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM bus_routes WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'تم حذف المسار بنجاح' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في حذف المسار' });
    }
});

module.exports = router;