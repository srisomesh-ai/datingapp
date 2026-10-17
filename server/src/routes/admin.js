import { Router } from 'express';
import { all, one, run } from '../db.js';
import { processWithdrawal } from '../billing.js';
import { HttpError, publicView, requireAdmin, requireAuth, requireOneOf } from '../util.js';
import fs from 'node:fs';
import { VERIFICATION } from '../config.js';
import { emitToUser } from '../realtime/hub.js';
import { selfiePath } from './verification.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/stats', (_req, res) => {
  res.json({
    users: one('SELECT COUNT(*) AS n FROM users').n,
    friends: one('SELECT COUNT(*) AS n FROM users WHERE is_host = 1').n,
    verified: one("SELECT COUNT(*) AS n FROM users WHERE verification_status = 'verified'").n,
    pendingVerifications: one("SELECT COUNT(*) AS n FROM verification_requests WHERE status = 'pending'").n,
    namesGuessed: one("SELECT COUNT(*) AS n FROM name_guesses WHERE status = 'correct'").n,
    connections: one('SELECT COUNT(*) AS n FROM connections').n,
    chatUnlocks: one('SELECT COUNT(*) AS n FROM chat_unlocks').n,
    chatUnlockPaise: one('SELECT COALESCE(SUM(amount_paise), 0) AS n FROM chat_unlocks').n,
    coinsEarned: one('SELECT COALESCE(SUM(coins_awarded), 0) AS n FROM name_guesses').n,
    paidCalls: one("SELECT COUNT(*) AS n FROM calls WHERE mode = 'paid' AND billed_minutes > 0").n,
    paidMinutes: one("SELECT COALESCE(SUM(billed_minutes), 0) AS n FROM calls WHERE mode = 'paid'").n,
    grossCallPaise: one('SELECT COALESCE(SUM(caller_paid_paise), 0) AS n FROM calls').n,
    platformFeePaise: one("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM transactions WHERE account = 'platform'").n,
    hostEarningsPaise: one('SELECT COALESCE(SUM(host_earned_paise), 0) AS n FROM calls').n,
    topupsPaise: one("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payments WHERE status = 'paid'").n,
    pendingWithdrawalsPaise: one("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM withdrawals WHERE status = 'pending'").n,
  });
});

router.get('/withdrawals', (_req, res) => {
  res.json({
    withdrawals: all(
      `SELECT w.id, w.amount_paise AS amountPaise, w.upi_id AS upiId, w.status, w.created_at AS createdAt, u.id AS userId, u.name, u.email
       FROM withdrawals w JOIN users u ON u.id = w.user_id ORDER BY w.status = 'pending' DESC, w.id DESC LIMIT 200`,
    ),
  });
});

router.post('/withdrawals/:id', (req, res) => {
  const action = requireOneOf(req.body?.action, ['paid', 'rejected'], 'action');
  res.json({ withdrawal: processWithdrawal(Number(req.params.id), action) });
});

router.get('/reports', (_req, res) => {
  res.json({
    reports: all(
      `SELECT r.id, r.reason, r.status, r.created_at AS createdAt, r.reported_id AS reportedId, ru.name AS reportedName,
              ru.is_banned AS reportedBanned, r.reporter_id AS reporterId, rp.name AS reporterName
       FROM reports r JOIN users ru ON ru.id = r.reported_id JOIN users rp ON rp.id = r.reporter_id
       ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200`,
    ),
  });
});

router.post('/reports/:id/close', (req, res) => {
  run("UPDATE reports SET status = 'closed' WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});

// ---- Selfie verification review ----
router.get('/verifications', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = all(
    `SELECT r.*, u.id AS uid FROM verification_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = ? ORDER BY r.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
    status,
  );
  res.json({
    verifications: rows.map((r) => {
      const u = one('SELECT * FROM users WHERE id = ?', r.uid);
      return {
        id: r.id,
        status: r.status,
        reason: r.reason,
        createdAt: r.created_at,
        pose: VERIFICATION.poses.find((p) => p.id === r.pose),
        user: { ...publicView(u), email: u.email },
        // The profile photo may have changed since the selfie was taken.
        photoChanged: u.photo_version !== r.photo_version,
      };
    }),
  });
});

router.get('/verifications/:id/selfie', (req, res) => {
  const r = one('SELECT * FROM verification_requests WHERE id = ?', Number(req.params.id));
  const file = r && selfiePath(r.user_id, r.id);
  if (!r || !fs.existsSync(file)) throw new HttpError(404, 'Selfie not found');
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(file);
});

router.post('/verifications/:id', (req, res) => {
  const action = requireOneOf(req.body?.action, ['approve', 'reject'], 'action');
  const r = one("SELECT * FROM verification_requests WHERE id = ? AND status = 'pending'", Number(req.params.id));
  if (!r) throw new HttpError(404, 'Pending verification not found');
  const reason = action === 'reject' ? String(req.body?.reason ?? '').trim().slice(0, 200) || "The selfie didn't match your photo or the pose" : null;
  run(
    'UPDATE verification_requests SET status = ?, reason = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?',
    action === 'approve' ? 'approved' : 'rejected',
    reason,
    req.user.id,
    r.id,
  );
  if (action === 'approve') {
    run("UPDATE users SET verification_status = 'verified', verification_note = NULL, verified_at = CURRENT_TIMESTAMP WHERE id = ?", r.user_id);
    emitToUser(r.user_id, 'verification:result', { status: 'verified', message: '✅ You are verified! A blue tick now shows on your profile.' });
  } else {
    run("UPDATE users SET verification_status = 'rejected', verification_note = ? WHERE id = ?", reason, r.user_id);
    emitToUser(r.user_id, 'verification:result', { status: 'rejected', message: `Verification not approved: ${reason}` });
  }
  res.json({ ok: true });
});

router.post('/users/:id/ban', (req, res) => {
  const banned = req.body?.banned !== false;
  const user = one('SELECT id, is_admin FROM users WHERE id = ?', Number(req.params.id));
  if (!user) throw new HttpError(404, 'User not found');
  if (user.is_admin) throw new HttpError(400, 'Cannot ban an admin');
  run('UPDATE users SET is_banned = ?, host_available = 0 WHERE id = ?', banned ? 1 : 0, user.id);
  res.json({ ok: true });
});

export default router;
