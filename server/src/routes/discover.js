import { Router } from 'express';
import { NAME_GUESS, SKIP_DAYS } from '../config.js';
import { all, one, run } from '../db.js';
import { ensureGuess, guessView, submitGuess } from '../connections.js';
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

/** A Discover card: photo and profile visible, name hidden behind a hint. */
function card(viewerId, u) {
  const g = ensureGuess(viewerId, u);
  return { ...publicView(u, { hideName: true, mask: g.mask }), guess: guessView(g) };
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
       AND NOT EXISTS (SELECT 1 FROM connections c WHERE (c.user_a = ? AND c.user_b = u.id) OR (c.user_a = u.id AND c.user_b = ?))
       AND NOT EXISTS (SELECT 1 FROM name_guesses g WHERE g.visitor_id = ? AND g.target_id = u.id
                       AND g.status = 'wrong' AND g.guessed_at > datetime('now', ?))
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
    me.id,
    `-${NAME_GUESS.retryHours} hours`,
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

// The only game: pick the right name. Right = connected (chat opens for both) and +coin.
router.post('/discover/:id/guess', (req, res) => {
  requireCompleteProfile(req.user);
  const t = target(req);
  ensureGuess(req.user.id, t);
  const guess = submitGuess(req.user.id, t.id, req.body?.optionIndex);
  if (guess.connected) {
    emitToUser(t.id, 'guess:correct', {
      user: publicView(req.user),
      message: `🎉 ${req.user.name} guessed your name! Your chat is open.`,
    });
  }
  const me = one('SELECT coins FROM users WHERE id = ?', req.user.id);
  res.json({ guess, profile: publicView(t, { hideName: !guess.connected, mask: guess.mask }), coins: me.coins });
});

export default router;
