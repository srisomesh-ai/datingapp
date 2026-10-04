import { Router } from 'express';
import { all, one, run } from '../db.js';
import { areConnected, hasSolved } from '../puzzle.js';
import { emitToUser, isOnline } from '../realtime/hub.js';
import { HttpError, isBlockedEitherWay, publicView, requireAuth, requireString } from '../util.js';
import { canSeeFullPhoto } from './profile.js';

const router = Router();
router.use(requireAuth);

const messageView = (m) => ({
  id: m.id,
  senderId: m.sender_id,
  receiverId: m.receiver_id,
  body: m.body,
  readAt: m.read_at,
  createdAt: m.created_at,
});

function partner(req) {
  const other = one('SELECT * FROM users WHERE id = ? AND is_banned = 0', Number(req.params.userId));
  if (!other || other.id === req.user.id) throw new HttpError(404, 'User not found');
  return other;
}

// A chat opens once either person has solved the other's photo puzzle.
router.get('/conversations', (req, res) => {
  const me = req.user.id;
  const rows = all(
    `WITH partners AS (
       SELECT target_id AS uid FROM puzzle_attempts WHERE visitor_id = ? AND status = 'solved'
       UNION SELECT visitor_id FROM puzzle_attempts WHERE target_id = ? AND status = 'solved'
     )
     SELECT u.*,
       (SELECT body FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?) ORDER BY m.id DESC LIMIT 1) AS last_body,
       (SELECT created_at FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?) ORDER BY m.id DESC LIMIT 1) AS last_at,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.read_at IS NULL) AS unread
     FROM partners p JOIN users u ON u.id = p.uid
     WHERE u.is_banned = 0
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
     ORDER BY last_at DESC NULLS LAST`,
    me, me, me, me, me, me, me, me, me,
  );
  res.json({
    conversations: rows.map((u) => ({
      user: publicView(u, { revealed: hasSolved(me, u.id) }),
      canSeePhoto: canSeeFullPhoto(me, u),
      online: isOnline(u.id),
      lastMessage: u.last_body,
      lastAt: u.last_at,
      unread: u.unread,
    })),
  });
});

router.get('/messages/:userId', (req, res) => {
  const other = partner(req);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = all(
    `SELECT * FROM messages WHERE id < ? AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
     ORDER BY id DESC LIMIT 50`,
    before,
    req.user.id,
    other.id,
    other.id,
    req.user.id,
  );
  res.json({
    user: publicView(other, { revealed: hasSolved(req.user.id, other.id) }),
    canSeePhoto: canSeeFullPhoto(req.user.id, other),
    canMessage: areConnected(req.user.id, other.id) && !isBlockedEitherWay(req.user.id, other.id),
    online: isOnline(other.id),
    messages: rows.reverse().map(messageView),
  });
});

router.post('/messages/:userId', (req, res) => {
  const other = partner(req);
  const body = requireString(req.body?.body, 'Message', { max: 2000 });
  if (isBlockedEitherWay(req.user.id, other.id)) throw new HttpError(403, 'You cannot message this person');
  if (!areConnected(req.user.id, other.id)) throw new HttpError(403, 'Solve their photo puzzle to unlock messaging');
  const { lastInsertRowid } = run('INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)', req.user.id, other.id, body);
  const msg = messageView(one('SELECT * FROM messages WHERE id = ?', lastInsertRowid));
  emitToUser(other.id, 'message:new', { message: msg, from: publicView(req.user) });
  emitToUser(req.user.id, 'message:new', { message: msg });
  res.status(201).json({ message: msg });
});

router.post('/messages/:userId/read', (req, res) => {
  const other = partner(req);
  run('UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL', other.id, req.user.id);
  emitToUser(other.id, 'message:read', { by: req.user.id });
  res.json({ ok: true });
});

export default router;
