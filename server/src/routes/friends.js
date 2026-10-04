// "Find a Friend": opt-in friends anyone can pay to voice/video call.
import { Router } from 'express';
import { all, one, run } from '../db.js';
import { affordableMinutes } from '../billing.js';
import { isBusy } from '../realtime/calls.js';
import { isOnline } from '../realtime/hub.js';
import { HttpError, hostRate, isProfileComplete, publicView, requireAuth, requireString, selfView } from '../util.js';

const router = Router();
router.use(requireAuth);

export function hostStatus(u) {
  if (!u.host_available || !isOnline(u.id)) return 'offline';
  return isBusy(u.id) ? 'busy' : 'available';
}

const ORDER = { available: 0, busy: 1, offline: 2 };

router.get('/friends', (req, res) => {
  const gender = ['male', 'female', 'other'].includes(req.query.gender) ? req.query.gender : null;
  const rows = all(
    `SELECT u.* FROM users u
     WHERE u.is_host = 1 AND u.is_banned = 0 AND u.has_photo = 1 AND u.id != ? AND (? IS NULL OR u.gender = ?)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
     LIMIT 200`,
    req.user.id,
    gender,
    gender,
    req.user.id,
    req.user.id,
  );
  const friends = rows
    .map((u) => {
      const rate = hostRate(u.gender);
      return {
        ...publicView(u),
        headline: u.host_headline,
        status: hostStatus(u),
        rate,
        affordableMinutes: affordableMinutes(req.user.id, rate.rateKey, rate.paisePerMinute),
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  res.json({ friends });
});

router.put('/friends/me', (req, res) => {
  const b = req.body ?? {};
  const updates = {};
  if (b.isHost !== undefined) {
    if (b.isHost && !isProfileComplete(req.user)) throw new HttpError(412, 'Complete your profile before becoming a friend');
    updates.is_host = b.isHost ? 1 : 0;
    if (!b.isHost) updates.host_available = 0;
  }
  if (b.hostAvailable !== undefined) {
    if (b.hostAvailable && !(updates.is_host ?? req.user.is_host)) throw new HttpError(400, 'Turn on friend mode first');
    updates.host_available = b.hostAvailable ? 1 : 0;
  }
  if (b.hostHeadline !== undefined) updates.host_headline = requireString(b.hostHeadline, 'Headline', { min: 0, max: 80 });
  const cols = Object.keys(updates);
  if (cols.length) run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(updates), req.user.id);
  res.json({ user: selfView(one('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

router.get('/calls', (req, res) => {
  const rows = all(
    `SELECT c.*, u.id AS other_id FROM calls c JOIN users u ON u.id = CASE WHEN c.caller_id = ? THEN c.callee_id ELSE c.caller_id END
     WHERE c.caller_id = ? OR c.callee_id = ? ORDER BY c.id DESC LIMIT 50`,
    req.user.id,
    req.user.id,
    req.user.id,
  );
  res.json({
    calls: rows.map((c) => {
      const outgoing = c.caller_id === req.user.id;
      return {
        id: c.id,
        direction: outgoing ? 'outgoing' : 'incoming',
        other: publicView(one('SELECT * FROM users WHERE id = ?', c.other_id)),
        media: c.media,
        mode: c.mode,
        status: c.status,
        minutes: c.billed_minutes,
        amountPaise: outgoing ? -c.caller_paid_paise : c.host_earned_paise,
        endReason: c.end_reason,
        startedAt: c.started_at,
        endedAt: c.ended_at,
        createdAt: c.created_at,
      };
    }),
  });
});

export default router;
