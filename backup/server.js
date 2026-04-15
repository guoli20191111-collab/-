const express    = require('express');
const mysql      = require('mysql2/promise');
const cors       = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// ── 数据库连接池 ───────────────────────────────────────────
const pool = mysql.createPool({
  host:            'localhost',
  port:            3306,
  user:            'root',
  password:        'Wanfeng6renxing',
  database:        'shimeng',
  charset:         'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

const IP_LIMIT    = 2;
const EMAIL_LIMIT = 2;
const ADMIN_TOKEN = 'shimeng-admin-2026';

// 邮箱白名单（无限次数）
const EMAIL_WHITELIST = new Set([
  '2502585436@qq.com',
  '980761950@qq.com',
  '363856804@qq.com',
  '936191433@qq.com',
  '2726437932@qq.com',
  '1832543078@qq.com',
]);

// ── 邮件发送配置（QQ邮箱）─────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   'smtp.qq.com',
  port:   465,
  secure: true,
  auth: {
    user: '1832543078@qq.com',
    pass: 'gkptsuesjpptfajf',
  },
});

// 验证码临时存储：email → { code, expiry, lastSent }
const emailCodeStore = new Map();

// ── 初始化数据库表 ─────────────────────────────────────────
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ip_limits (
        ip         VARCHAR(64) NOT NULL PRIMARY KEY,
        count      INT         NOT NULL DEFAULT 0,
        updated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whitelist (
        ip         VARCHAR(64)  NOT NULL PRIMARY KEY,
        remark     VARCHAR(100) DEFAULT '',
        created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS email_limits (
        email      VARCHAR(255) NOT NULL PRIMARY KEY,
        count      INT          NOT NULL DEFAULT 0,
        updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] 表初始化完成');
  } finally {
    conn.release();
  }
}
initDB();

// ── 工具函数 ───────────────────────────────────────────────
function getIP(req) {
  return (req.headers['x-real-ip'] ||
          (req.headers['x-forwarded-for'] || '').split(',')[0] ||
          req.socket.remoteAddress || '').trim();
}

async function isWhitelisted(conn, ip) {
  const [rows] = await conn.execute('SELECT 1 FROM whitelist WHERE ip = ?', [ip]);
  return rows.length > 0;
}

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: '无权限' });
  next();
}

// ── 基础接口 ───────────────────────────────────────────────
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Tencent Cloud!', timestamp: new Date().toISOString() });
});

// ── IP 限额接口 ────────────────────────────────────────────
app.get('/api/check-limit', async (req, res) => {
  const ip = getIP(req);
  const conn = await pool.getConnection();
  try {
    if (await isWhitelisted(conn, ip)) {
      return res.json({ allowed: true, count: 0, remaining: 999, limit: IP_LIMIT, whitelisted: true });
    }
    const [rows] = await conn.execute('SELECT count FROM ip_limits WHERE ip = ?', [ip]);
    const count = rows.length > 0 ? rows[0].count : 0;
    res.json({ allowed: count < IP_LIMIT, count, remaining: Math.max(0, IP_LIMIT - count), limit: IP_LIMIT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/record-generation', async (req, res) => {
  const ip = getIP(req);
  const conn = await pool.getConnection();
  try {
    if (await isWhitelisted(conn, ip)) {
      return res.json({ success: true, count: 0, remaining: 999, whitelisted: true });
    }
    await conn.execute(`
      INSERT INTO ip_limits (ip, count) VALUES (?, 1)
      ON DUPLICATE KEY UPDATE count = count + 1
    `, [ip]);
    const [rows] = await conn.execute('SELECT count FROM ip_limits WHERE ip = ?', [ip]);
    const count = rows[0].count;
    res.json({ success: true, count, remaining: Math.max(0, IP_LIMIT - count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── 邮箱验证码接口 ─────────────────────────────────────────

// 发送验证码
app.post('/api/send-email-code', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  // 60 秒内禁止重复发送
  const existing = emailCodeStore.get(email);
  if (existing && Date.now() < existing.lastSent + 60 * 1000) {
    const wait = Math.ceil((existing.lastSent + 60000 - Date.now()) / 1000);
    return res.status(429).json({ error: `请 ${wait} 秒后再获取` });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  emailCodeStore.set(email, { code, expiry: Date.now() + 5 * 60 * 1000, lastSent: Date.now() });

  try {
    await transporter.sendMail({
      from: '"拾梦录" <1832543078@qq.com>',
      to: email,
      subject: '拾梦录 · 登录验证码',
      html: `
        <div style="background:#08060f;padding:48px 40px;font-family:serif;text-align:center;max-width:480px;margin:0 auto;">
          <div style="font-size:22px;font-weight:bold;color:#c8a064;letter-spacing:0.3em;margin-bottom:6px;">拾梦录</div>
          <div style="font-size:13px;color:rgba(200,160,100,0.5);letter-spacing:0.25em;margin-bottom:36px;">旧梦可拾，此刻成录</div>
          <div style="background:rgba(200,160,100,0.06);border:1px solid rgba(200,160,100,0.18);border-radius:10px;padding:36px;">
            <div style="font-size:13px;color:rgba(255,240,210,0.5);letter-spacing:0.15em;margin-bottom:20px;">你的登录验证码</div>
            <div style="font-size:40px;font-weight:bold;color:#c8a064;letter-spacing:0.6em;padding-left:0.6em;">${code}</div>
            <div style="font-size:12px;color:rgba(255,240,210,0.3);margin-top:20px;letter-spacing:0.1em;">5 分钟内有效 · 请勿泄露给他人</div>
          </div>
        </div>
      `,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Email Error]', err.message);
    emailCodeStore.delete(email);
    res.status(500).json({ error: '邮件发送失败，请稍后重试' });
  }
});

// 验证验证码
app.post('/api/verify-email-code', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: '参数缺失' });

  const record = emailCodeStore.get(email);
  if (!record) return res.status(400).json({ error: '验证码不存在或已过期' });
  if (Date.now() > record.expiry) {
    emailCodeStore.delete(email);
    return res.status(400).json({ error: '验证码已过期，请重新获取' });
  }
  if (record.code !== code.trim()) {
    return res.status(400).json({ error: '验证码错误' });
  }

  emailCodeStore.delete(email);
  res.json({ success: true, email });
});

// ── 邮箱生成次数限制接口 ───────────────────────────────────

app.get('/api/check-email-limit', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: '缺少 email 参数' });
  if (EMAIL_WHITELIST.has(email)) {
    return res.json({ allowed: true, count: 0, remaining: 999, whitelisted: true });
  }
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT count FROM email_limits WHERE email = ?', [email]);
    const count = rows.length > 0 ? rows[0].count : 0;
    res.json({ allowed: count < EMAIL_LIMIT, count, remaining: Math.max(0, EMAIL_LIMIT - count), limit: EMAIL_LIMIT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/record-email-generation', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '缺少 email 参数' });
  if (EMAIL_WHITELIST.has(email)) {
    return res.json({ success: true, count: 0, remaining: 999, whitelisted: true });
  }
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      INSERT INTO email_limits (email, count) VALUES (?, 1)
      ON DUPLICATE KEY UPDATE count = count + 1
    `, [email]);
    const [rows] = await conn.execute('SELECT count FROM email_limits WHERE email = ?', [email]);
    const count = rows[0].count;
    res.json({ success: true, count, remaining: Math.max(0, EMAIL_LIMIT - count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── 白名单管理接口 ─────────────────────────────────────────
app.get('/api/admin/whitelist', adminAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT ip, remark, created_at FROM whitelist ORDER BY created_at DESC');
    res.json({ success: true, list: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/whitelist', adminAuth, async (req, res) => {
  const { ip, remark = '' } = req.body;
  if (!ip) return res.status(400).json({ error: '缺少 ip 参数' });
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      'INSERT INTO whitelist (ip, remark) VALUES (?, ?) ON DUPLICATE KEY UPDATE remark = ?',
      [ip, remark, remark]
    );
    res.json({ success: true, message: `${ip} 已加入白名单` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/admin/whitelist/:ip', adminAuth, async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const conn = await pool.getConnection();
  try {
    await conn.execute('DELETE FROM whitelist WHERE ip = ?', [ip]);
    res.json({ success: true, message: `${ip} 已移出白名单` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.get('/api/admin/ip-status', adminAuth, async (req, res) => {
  const ip = req.query.ip || getIP(req);
  const conn = await pool.getConnection();
  try {
    const whitelisted = await isWhitelisted(conn, ip);
    const [rows] = await conn.execute('SELECT count FROM ip_limits WHERE ip = ?', [ip]);
    const count = rows.length > 0 ? rows[0].count : 0;
    res.json({ ip, whitelisted, count, remaining: whitelisted ? 999 : Math.max(0, IP_LIMIT - count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/reset-ip', adminAuth, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: '缺少 ip 参数' });
  const conn = await pool.getConnection();
  try {
    await conn.execute('DELETE FROM ip_limits WHERE ip = ?', [ip]);
    res.json({ success: true, message: `${ip} 次数已重置` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── 图片代理（绕过跨域，供前端 Canvas 加水印用）────────────
const https = require('https');
const http  = require('http');

app.get('/api/proxy-image', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'missing url' });
  try {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    client.get(url, (imgRes) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/png');
      imgRes.pipe(res);
    }).on('error', () => res.status(500).json({ error: 'fetch failed' }));
  } catch (e) {
    res.status(400).json({ error: 'invalid url' });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('[READY] http://0.0.0.0:3000');
});
