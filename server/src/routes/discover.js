import { Router } from 'express';
import { NAME_GUESS, SKIP_DAYS } from '../config.js';
import { all, one, run } from '../db.js';
import { declineLike, ensureGuess, guessView, hasLiked, likeUser, submitGuess } from '../connections.js';
import { emitToUser } from '../realtime/hub.js';
import { HttpError, isBlockedEitherWay, isProfileComplete, publicView, requireAuth, shuffle } from '../util.js';

const router = Router();
router.use(requireAuth);

function requireCompleteProfile(user) {
  if (!isProfileComplete(user)) throw new HttpError(412, 'Complete your profile (photo, hobbies, likes) first');
}

function target(req) {
  const u = one('SELECT * FROM users WHERE id = ? AND is_banned = 0', Number(req.params.id));
  if (!u || u.id === req.user.id || isBlockedEitherWay(req.user.id, u.id)) throw new HttpError(404, 'User not found');
  return u;
}

/** A Discover card: photo and profile visible, name hidden until guessed. */
function card(viewerId, u) {
  const g = ensureGuess(viewerId, u);
  const guessed = g.status !== 'pending';
  return { ...publicView(u, { hideName: !guessed, mask: g.mask }), guess: guessView(g), likesYou: hasLiked(u.id, viewerId) };
}

router.get('/discover', (req, res) => {
  const me = req.user;
  requireCompleteProfile(me);
  const rows = all(
    `SELECT u.* FROM users u
     WHERE u.id != ? AND u.is_banned = 0 AND u.has_photo = 1
       AND (? = 'everyone' OR u.gender = ?)
       AND (u.interested_in = 'everyone' OR u.interested_in = ?)
       AND (u.looking_for = 'both' OR ? = 'both' OR u.looking_for = ?)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
       AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_id = ? AND l.to_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM discover_skips s WHERE s.visitor_id = ? AND s.target_id = u.id
                       AND s.created_at > datetime('now', ?))
     ORDER BY u.last_seen_at DESC NULLS LAST, u.id DESC
     LIMIT 100`,
    me.id,
    me.interested_in,
    me.interested_in,
    me.gender,
    me.looking_for,
    me.looking_for,
    me.id,
    me.id,
    me.id,
    me.id,
    `-${SKIP_DAYS} days`,
  );
  const picked = shuffle(rows.filter(isProfileComplete)).slice(0, 20);
  res.json({ profiles: picked.map((u) => card(me.id, u)), rules: NAME_GUESS });
});

router.post('/discover/:id/skip', (req, res) => {
  run(
    `INSERT INTO discover_skips (visitor_id, target_id) VALUES (?, ?)
     ON CONFLICT (visitor_id, target_id) DO UPDATE SET created_at = CURRENT_TIMESTAMP`,
    req.user.id,
    target(req).id,
  );
  res.json({ ok: true });
});

router.post('/discover/:id/guess', (req, res) => {
  requireCompleteProfile(req.user);
  const t = target(req);
  ensureGuess(req.user.id, t);
  const guess = submitGuess(req.user.id, t.id, req.body?.optionIndex);
  const me = one('SELECT coins FROM users WHERE id = ?', req.user.id);
  res.json({ guess, profile: publicView(t), coins: me.coins });
});

router.post('/discover/:id/like', (req, res) => {
  requireCompleteProfile(req.user);
  const t = target(req);
  const { matched } = likeUser(req.user.id, t.id, req.body?.message);
  const from = publicView(req.user);
  if (matched) {
    emitToUser(t.id, 'match:new', { user: from, message: `It's a match with ${req.user.name}! 🎉` });
  } else {
    emitToUser(t.id, 'like:new', { user: from, message: `${req.user.name} liked you ❤️` });
  }
  res.json({ matched, profile: publicView(t) });
});

// People who liked me and I haven't answered yet (with their intro message, if any).
router.get('/likes', (req, res) => {
  const rows = all(
    `SELECT u.*, l.message AS like_message, l.created_at AS liked_at FROM likes l JOIN users u ON u.id = l.from_id
     WHERE l.to_id = ? AND l.declined = 0 AND u.is_banned = 0
       AND NOT EXISTS (SELECT 1 FROM likes back WHERE back.from_id = ? AND back.to_id = u.id)
     ORDER BY l.created_at DESC LIMIT 100`,
    req.user.id,
    req.user.id,
  );
  res.json({
    likes: rows
      .filter((u) => !isBlockedEitherWay(req.user.id, u.id))
      .map((u) => ({ user: publicView(u), message: u.like_message, likedAt: u.liked_at })),
  });
});

router.post('/likes/:id/accept', (req, res) => {
  const t = target(req);
  if (!hasLiked(t.id, req.user.id)) throw new HttpError(404, 'Like not found');
  likeUser(req.user.id, t.id, null);
  emitToUser(t.id, 'match:new', { user: publicView(req.user), message: `${req.user.name} liked you back. It's a match! 🎉` });
  res.json({ matched: true });
});

router.post('/likes/:id/decline', (req, res) => {
  declineLike(req.user.id, target(req).id);
  res.json({ ok: true });
});

export default router;
