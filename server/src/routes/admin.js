import { Router } from 'express';
import { all, one, run } from '../db.js';
import { processWithdrawal } from '../billing.js';
import { HttpError, requireAdmin, requireAuth, requireOneOf } from '../util.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/stats', (_req, res) => {
  res.json({
    users: one('SELECT COUNT(*) AS n FROM users').n,
    friends: one('SELECT COUNT(*) AS n FROM users WHERE is_host = 1').n,
    puzzlesSolved: one("SELECT COUNT(*) AS n FROM puzzle_attempts WHERE status = 'solved'").n,
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

router.post('/users/:id/ban', (req, res) => {
  const banned = req.body?.banned !== false;
  const user = one('SELECT id, is_admin FROM users WHERE id = ?', Number(req.params.id));
  if (!user) throw new HttpError(404, 'User not found');
  if (user.is_admin) throw new HttpError(400, 'Cannot ban an admin');
  run('UPDATE users SET is_banned = ?, host_available = 0 WHERE id = ?', banned ? 1 : 0, user.id);
  res.json({ ok: true });
});

export default router;
