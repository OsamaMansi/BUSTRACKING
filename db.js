const { Pool } = require('pg');
require('dotenv').config(); // لاستدعاء المتغيرات من ملف .env

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // مطلوب للاتصال السحابي مع Supabase
    }
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};