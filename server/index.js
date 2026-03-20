// server/index.js
const express    = require('express');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const dotenv     = require('dotenv');

dotenv.config();

/* ── strip spaces from App Password (common mistake) ─────────── */
const EMAIL      = (process.env.EMAIL      || '').trim();
const EMAIL_PASS = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');  // removes ALL spaces

if (!EMAIL || !EMAIL_PASS) {
  console.error('\n❌  MISSING .env VARS — create server/.env with:\n');
  console.error('    EMAIL=yonasmindaye04@gmail.com');
  console.error('    EMAIL_PASS=abcdefghijklmnop   ← 16 chars, no spaces\n');
  console.error('👉  https://myaccount.google.com/apppasswords\n');
  process.exit(1);
}

console.log('✅  EMAIL loaded:', EMAIL);
console.log('✅  PASS length :', EMAIL_PASS.length, '(should be 16)');

const app = express();

/* ── middleware ─────────────────────────────────────────────── */
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ],
  methods: ['GET', 'POST'],
}));
app.use(express.json());

/* ── transporter ────────────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL, pass: EMAIL_PASS },
});

transporter.verify((err) => {
  if (err) {
    console.error('\n❌  SMTP FAILED:', err.message);
    console.error('    → Your App Password is wrong or 2FA is not enabled.');
    console.error('    → Fix: https://myaccount.google.com/apppasswords\n');
  } else {
    console.log('✅  SMTP verified — ready to send emails\n');
  }
});

/* ── health check ───────────────────────────────────────────── */
app.get('/api/health', (_req, res) => res.json({ ok: true, email: EMAIL }));

/* ── contact ────────────────────────────────────────────────── */
app.post('/api/contact', async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name?.trim() || !email?.trim() || !message?.trim())
    return res.status(400).json({ success: false, message: 'Name, email and message are required.' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ success: false, message: 'Invalid email address.' });

  try {
    /* — notification to you — */
    await transporter.sendMail({
      from:    `"EthioDigital" <${EMAIL}>`,
      to:      EMAIL,
      replyTo: email,
      subject: `🚀 New Inquiry from ${name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#09090b;color:#f4f0e8;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#d4a853,#e8c06a);padding:28px 32px;">
            <h2 style="margin:0;color:#09090b;">New Project Inquiry</h2>
            <p style="margin:4px 0 0;color:#09090b;opacity:.7;font-size:.88rem;">via EthioDigital contact form</p>
          </div>
          <div style="padding:32px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#94a3b8;font-size:.85rem;width:100px;">Name</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);font-weight:600;">${name}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#94a3b8;font-size:.85rem;">Email</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);"><a href="mailto:${email}" style="color:#d4a853;">${email}</a></td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#94a3b8;font-size:.85rem;">Phone</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);">${phone || 'Not provided'}</td></tr>
              <tr><td style="padding:14px 0;color:#94a3b8;font-size:.85rem;vertical-align:top;">Message</td><td style="padding:14px 0;line-height:1.65;">${message.replace(/\n/g,'<br>')}</td></tr>
            </table>
            <a href="mailto:${email}" style="display:inline-block;margin-top:22px;background:#d4a853;color:#09090b;padding:12px 26px;border-radius:50px;text-decoration:none;font-weight:700;font-size:.9rem;">Reply to ${name}</a>
          </div>
        </div>`,
    });

    /* — auto-reply to client — */
    await transporter.sendMail({
      from:    `"EthioDigital" <${EMAIL}>`,
      to:      email,
      subject: `We got your message, ${name.split(' ')[0]}! ✓`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#09090b;color:#f4f0e8;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#d4a853,#e8c06a);padding:28px 32px;">
            <h2 style="margin:0;color:#09090b;">Thanks for reaching out! 🚀</h2>
          </div>
          <div style="padding:32px;line-height:1.7;">
            <p>Hi <strong>${name.split(' ')[0]}</strong>,</p>
            <p style="margin-top:14px;">We've received your message and will reply within <strong>24 hours</strong> with a detailed proposal.</p>
            <p style="margin-top:20px;color:#94a3b8;font-size:.9rem;">You can also reach us directly:</p>
            <ul style="margin-top:8px;padding-left:18px;color:#94a3b8;font-size:.9rem;line-height:2;">
              <li>Telegram: <a href="https://t.me/yona64" style="color:#29b6f6;">@yona64</a></li>
              <li>WhatsApp: <a href="https://wa.me/251910011818" style="color:#25d366;">+251-910011818</a></li>
            </ul>
            <p style="margin-top:28px;color:#6b7280;font-size:.85rem;">— The EthioDigital Team</p>
          </div>
        </div>`,
    });

    console.log(`📨  Sent for ${name} <${email}>`);
    res.json({ success: true });

  } catch (err) {
    console.error('❌  Send error:', err.message);
    res.status(500).json({ success: false, message: 'Email failed. Please contact us directly on Telegram.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀  Server → http://localhost:${PORT}`);
  console.log(`💌  Health → http://localhost:${PORT}/api/health\n`);
});