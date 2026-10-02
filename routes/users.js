const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. جلب قائمة جميع المستخدمين
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT id, full_name, email, phone, role, is_active FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب المستخدمين' });
    }
});

// 2. إضافة مستخدم جديد
router.post('/', async (req, res) => {
    let { full_name, email, phone, role, password } = req.body;
    
    // معالجة البريد الإلكتروني والهاتف ليكونوا null إذا تم تركهم فارغين (لتجاوز شرط عدم التكرار للفراغات)
    email = email && email.trim() !== '' ? email.trim() : null;
    phone = phone && phone.trim() !== '' ? phone.trim() : null;

    try {
        const result = await db.query(
            'INSERT INTO users (full_name, email, phone, role, password_hash, is_active) VALUES ($1, $2, $3, $4, $5, true) RETURNING id, full_name, role',
            [full_name, email, phone, role, password]
        );
        res.json({ success: true, user: result.rows[0], message: 'تمت إضافة المستخدم بنجاح' });
    } catch (err) {
        // 23505 هو كود الخطأ في PostgreSQL عند تكرار قيمة فريدة (Unique)
        if (err.code === '23505') {
            if (err.constraint.includes('phone')) return res.status(400).json({ error: 'رقم الهاتف مستخدم مسبقاً!' });
            if (err.constraint.includes('email')) return res.status(400).json({ error: 'البريد الإلكتروني مستخدم مسبقاً!' });
        }
        console.error(err.message);
        res.status(500).json({ error: 'حدث خطأ داخلي في السيرفر' });
    }
});

// 3. تعديل بيانات مستخدم (تحديث)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    let { full_name, email, phone, role } = req.body;
    
    email = email && email.trim() !== '' ? email.trim() : null;
    phone = phone && phone.trim() !== '' ? phone.trim() : null;

    try {
        await db.query(
            'UPDATE users SET full_name = $1, email = $2, phone = $3, role = $4 WHERE id = $5',
            [full_name, email, phone, role, id]
        );
        res.json({ success: true, message: 'تم تحديث البيانات بنجاح' });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'البريد الإلكتروني أو رقم الهاتف موجود مسبقاً لمستخدم آخر!' });
        }
        res.status(500).json({ error: 'خطأ في تحديث البيانات' });
    }
});

// 4. تفعيل/إيقاف مستخدم
router.patch('/:id/toggle-status', async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body; // true = فعال, false = موقوف
    try {
        await db.query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active, id]);
        res.json({ success: true, message: is_active ? 'تم تفعيل الحساب' : 'تم إيقاف الحساب' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في تغيير حالة المستخدم' });
    }
});

// 5. حذف مستخدم نهائياً
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM users WHERE id = $1', [id]);
        res.json({ success: true, message: 'تم حذف المستخدم نهائياً' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في الحذف، قد يكون المستخدم مرتبطاً برحلات أو بيانات أخرى' });
    }
});

module.exports = router;