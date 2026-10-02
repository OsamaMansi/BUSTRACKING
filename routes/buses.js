const express = require('express');
const router = express.Router();
const db = require('../db');

// جلب جميع الحافلات
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM buses ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب بيانات الحافلات' });
    }
});

// إضافة حافلة جديدة
router.post('/', async (req, res) => {
    const { plate_number, capacity } = req.body;
    try {
        await db.query(
            'INSERT INTO buses (plate_number, capacity, is_active) VALUES ($1, $2, true)',
            [plate_number, capacity]
        );
        res.json({ success: true, message: 'تمت إضافة الحافلة بنجاح' });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'رقم اللوحة مسجل مسبقاً!' });
        res.status(500).json({ error: 'حدث خطأ أثناء الإضافة' });
    }
});

// تعديل بيانات حافلة
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { plate_number, capacity } = req.body;
    try {
        await db.query(
            'UPDATE buses SET plate_number = $1, capacity = $2 WHERE id = $3',
            [plate_number, capacity, id]
        );
        res.json({ success: true, message: 'تم تحديث بيانات الحافلة بنجاح' });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'رقم اللوحة موجود مسبقاً لحافلة أخرى!' });
        res.status(500).json({ error: 'خطأ في تحديث البيانات' });
    }
});

// تفعيل أو إيقاف الحافلة
router.patch('/:id/toggle-status', async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;
    try {
        await db.query('UPDATE buses SET is_active = $1 WHERE id = $2', [is_active, id]);
        res.json({ success: true, message: is_active ? 'تم تفعيل الحساب' : 'تم إيقاف الحافلة' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في تغيير حالة الحافلة' });
    }
});

// حذف حافلة
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM buses WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'تم حذف الحافلة' });
    } catch (err) {
        res.status(500).json({ error: 'لا يمكن حذف الحافلة' });
    }
});

module.exports = router;