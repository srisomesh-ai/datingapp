import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ADMIN_EMAILS, CATALOG } from '../config.js';
import { one, run } from '../db.js';
import { COOKIE, HttpError, ageFromDob, requireAuth, requireOneOf, requireString, selfView, setAuthCookie, signToken } from '../util.js';

const router = Router();

// Tiny in-memory limiter for credential endpoints (per IP).
const attempts = new Map();
function limit(req, _res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key) ?? { count: 0, reset: now + 15 * 60_000 };
  if (now > entry.reset) Object.assign(entry, { count: 0, reset: now + 15 * 60_000 });
  entry.count++;
  attempts.set(key, entry);
  if (entry.count > 30) return next(new HttpError(429, 'Too many attempts, try again later'));
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', limit, async (req, res) => {
  const b = req.body ?? {};
  const email = requireString(b.email, 'Email', { max: 200 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');
  const password = requireString(b.password, 'Password', { min: 8, max: 200 });
  const name = requireString(b.name, 'Name', { max: 40 });
  const gender = requireOneOf(b.gender, CATALOG.genders, 'gender');
  const dob = requireString(b.dob, 'Date of birth', { max: 10 });
  const age = ageFromDob(dob);
  if (age === null) throw new HttpError(400, 'Enter a valid date of birth');
  if (age < 18) throw new HttpError(400, 'You must be 18 or older to join');
  const phone = b.phone ? requireString(b.phone, 'Phone', { max: 20 }) : null;

  if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists');
  const hash = await bcrypt.hash(password, 10);
  const { lastInsertRowid } = run(
    'INSERT INTO users (email, phone, password_hash, name, gender, dob, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
    email,
    phone,
    hash,
    name,
    gender,
    dob,
    ADMIN_EMAILS.includes(email) ? 1 : 0,
  );
  const token = signToken(Number(lastInsertRowid));
  setAuthCookie(res, token);
  res.status(201).json({ token, user: selfView(one('SELECT * FROM users WHERE id = ?', lastInsertRowid)) });
});

router.post('/login', limit, async (req, res) => {
  const email = requireString(req.body?.email, 'Email').toLowerCase();
  const password = requireString(req.body?.password, 'Password');
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw new HttpError(401, 'Wrong email or password');
  if (user.is_banned) throw new HttpError(403, 'This account has been suspended');
  const token = signToken(user.id);
  setAuthCookie(res, token);
  res.json({ token, user: selfView(user) });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: selfView(req.user) });
});

export default router;
