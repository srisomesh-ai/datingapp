import { Router } from 'express';
import { CHAT } from '../config.js';
import { all, one, run, tx } from '../db.js';
import { ledger } from '../billing.js';
import { connectionOf, isConnected } from '../connections.js';
import { emitToUser, isOnline } from '../realtime/hub.js';
import { HttpError, isBlockedEitherWay, publicView, requireAuth, requireString } from '../util.js';

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
  if (!isConnected(req.user.id, other.id)) throw new HttpError(403, 'Guess their name right to start chatting');
  return other;
}

/** Free messages left for `me` in this chat, or unlimited once they've paid. */
export function chatAllowance(meId, otherId) {
  const unlocked = Boolean(one('SELECT 1 FROM chat_unlocks WHERE user_id = ? AND partner_id = ?', meId, otherId));
  const sent = one('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND receiver_id = ?', meId, otherId).n;
  return {
    unlocked,
    freeTotal: CHAT.freeMessagesPerPerson,
    freeLeft: unlocked ? null : Math.max(0, CHAT.freeMessagesPerPerson - sent),
    unlockPricePaise: CHAT.unlockPricePaise,
  };
}

// Chats are with people you're connected to (one of you guessed the other's name).
router.get('/conversations', (req, res) => {
  const me = req.user.id;
  const rows = all(
    `WITH partners AS (
       SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS uid, guesser_id, created_at AS connected_at
       FROM connections WHERE user_a = ? OR user_b = ?
     )
     SELECT u.*, p.guesser_id, p.connected_at,
       (SELECT body FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?) ORDER BY m.id DESC LIMIT 1) AS last_body,
       (SELECT created_at FROM messages m WHERE (m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?) ORDER BY m.id DESC LIMIT 1) AS last_at,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.read_at IS NULL) AS unread
     FROM partners p JOIN users u ON u.id = p.uid
     WHERE u.is_banned = 0
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
     ORDER BY COALESCE(last_at, connected_at) DESC`,
    me, me, me, me, me, me, me, me, me, me,
  );
  res.json({
    conversations: rows.map((u) => ({
      user: publicView(u),
      online: isOnline(u.id),
      // Who guessed whom, for the "guessed your name" label on new chats.
      guessedYou: u.guesser_id === u.id,
      lastMessage: u.last_body,
      lastAt: u.last_at ?? u.connected_at,
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
    user: publicView(other),
    guessedYou: connectionOf(req.user.id, other.id).guesser_id === other.id,
    canMessage: !isBlockedEitherWay(req.user.id, other.id),
    chat: chatAllowance(req.user.id, other.id),
    online: isOnline(other.id),
    messages: rows.reverse().map(messageView),
  });
});

router.post('/messages/:userId', (req, res) => {
  const other = partner(req);
  const body = requireString(req.body?.body, 'Message', { max: 2000 });
  if (isBlockedEitherWay(req.user.id, other.id)) throw new HttpError(403, 'You cannot message this person');
  const allowance = chatAllowance(req.user.id, other.id);
  if (!allowance.unlocked && allowance.freeLeft <= 0) {
    throw new HttpError(402, `You've used your ${CHAT.freeMessagesPerPerson} free messages. Unlock the chat to keep talking.`, {
      code: 'chat_limit',
      chat: allowance,
    });
  }
  const { lastInsertRowid } = run('INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)', req.user.id, other.id, body);
  const msg = messageView(one('SELECT * FROM messages WHERE id = ?', lastInsertRowid));
  emitToUser(other.id, 'message:new', { message: msg, from: publicView(req.user) });
  emitToUser(req.user.id, 'message:new', { message: msg });
  res.status(201).json({ message: msg, chat: chatAllowance(req.user.id, other.id) });
});

// Pay once (from the wallet) for unlimited messages to this person.
router.post('/messages/:userId/unlock', (req, res) => {
  const other = partner(req);
  tx(() => {
    if (one('SELECT 1 FROM chat_unlocks WHERE user_id = ? AND partner_id = ?', req.user.id, other.id)) return;
    const { wallet_paise: wallet } = one('SELECT wallet_paise FROM users WHERE id = ?', req.user.id);
    if (wallet < CHAT.unlockPricePaise) throw new HttpError(402, 'Not enough wallet balance. Please add money first.', { code: 'insufficient_balance' });
    run('UPDATE users SET wallet_paise = wallet_paise - ? WHERE id = ?', CHAT.unlockPricePaise, req.user.id);
    run('INSERT INTO chat_unlocks (user_id, partner_id, amount_paise) VALUES (?, ?, ?)', req.user.id, other.id, CHAT.unlockPricePaise);
    ledger(req.user.id, 'wallet', 'chat_unlock', -CHAT.unlockPricePaise, { refType: 'user', refId: other.id });
    ledger(null, 'platform', 'chat_unlock', CHAT.unlockPricePaise, { refType: 'user', refId: req.user.id });
  });
  res.json({ chat: chatAllowance(req.user.id, other.id), walletPaise: one('SELECT wallet_paise FROM users WHERE id = ?', req.user.id).wallet_paise });
});

router.post('/messages/:userId/read', (req, res) => {
  const other = partner(req);
  run('UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL', other.id, req.user.id);
  emitToUser(other.id, 'message:read', { by: req.user.id });
  res.json({ ok: true });
});

export default router;
