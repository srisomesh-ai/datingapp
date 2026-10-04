import { Router } from 'express';
import { PUZZLE, SKIP_DAYS } from '../config.js';
import { all, one, run } from '../db.js';
import { answerPuzzle, latestAttempt, puzzleState, startPuzzle } from '../puzzle.js';
import { emitToUser } from '../realtime/hub.js';
import { HttpError, isBlockedEitherWay, isProfileComplete, publicView, requireAuth, shuffle } from '../util.js';

const router = Router();
router.use(requireAuth);

function requireCompleteProfile(user) {
  if (!isProfileComplete(user)) throw new HttpError(412, 'Complete your profile (photo, hobbies, likes) to play puzzles');
}

router.get('/discover', (req, res) => {
  const me = req.user;
  const rows = all(
    `SELECT u.* FROM users u
     WHERE u.id != ? AND u.is_banned = 0 AND u.has_photo = 1
       AND (? = 'everyone' OR u.gender = ?)
       AND (u.interested_in = 'everyone' OR u.interested_in = ?)
       AND (u.looking_for = 'both' OR ? = 'both' OR u.looking_for = ?)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
       AND NOT EXISTS (SELECT 1 FROM discover_skips s WHERE s.visitor_id = ? AND s.target_id = u.id
                       AND s.created_at > datetime('now', ?))
       AND NOT EXISTS (SELECT 1 FROM puzzle_attempts p WHERE p.visitor_id = ? AND p.target_id = u.id
                       AND (p.status = 'solved' OR (p.status = 'failed' AND p.updated_at > datetime('now', ?))))
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
    `-${SKIP_DAYS} days`,
    me.id,
    `-${PUZZLE.cooldownHours} hours`,
  );
  const candidates = shuffle(rows.filter(isProfileComplete)).slice(0, 20);
  res.json({
    profiles: candidates.map((u) => {
      const attempt = latestAttempt(me.id, u.id);
      return {
        ...publicView(u),
        puzzle: attempt ? { status: attempt.status, revealed: JSON.parse(attempt.revealed) } : null,
      };
    }),
    rules: PUZZLE,
  });
});

router.post('/discover/:id/skip', (req, res) => {
  run(
    `INSERT INTO discover_skips (visitor_id, target_id) VALUES (?, ?)
     ON CONFLICT (visitor_id, target_id) DO UPDATE SET created_at = CURRENT_TIMESTAMP`,
    req.user.id,
    Number(req.params.id),
  );
  res.json({ ok: true });
});

router.post('/discover/:id/puzzle', (req, res) => {
  requireCompleteProfile(req.user);
  const target = one('SELECT * FROM users WHERE id = ? AND is_banned = 0', Number(req.params.id));
  if (!target || target.id === req.user.id) throw new HttpError(404, 'User not found');
  if (isBlockedEitherWay(req.user.id, target.id)) throw new HttpError(404, 'User not found');
  if (!isProfileComplete(target)) throw new HttpError(409, 'This profile is not ready for puzzles yet');
  const attempt = startPuzzle(req.user, target);
  res.json({ puzzle: puzzleState(attempt), profile: publicView(target, { revealed: attempt.status === 'solved' }) });
});

router.post('/puzzles/:attemptId/answer', (req, res) => {
  const { questionIndex, optionIndex } = req.body ?? {};
  const state = answerPuzzle(req.user.id, Number(req.params.attemptId), questionIndex, optionIndex);
  let profile;
  if (state.status === 'solved') {
    const target = one('SELECT * FROM users WHERE id = ?', state.targetId);
    profile = publicView(target, { revealed: true });
    emitToUser(target.id, 'puzzle:solved', {
      by: publicView(req.user),
      message: `${req.user.name} solved your puzzle and can now message you!`,
    });
  }
  res.json({ puzzle: state, profile });
});

// People who solved *my* puzzle (they can message me; I can play theirs back).
router.get('/admirers', (req, res) => {
  const rows = all(
    `SELECT u.*, MAX(p.updated_at) AS solved_at FROM puzzle_attempts p JOIN users u ON u.id = p.visitor_id
     WHERE p.target_id = ? AND p.status = 'solved' AND u.is_banned = 0
     GROUP BY u.id ORDER BY solved_at DESC LIMIT 100`,
    req.user.id,
  );
  res.json({
    admirers: rows
      .filter((u) => !isBlockedEitherWay(req.user.id, u.id))
      .map((u) => {
        const mine = latestAttempt(req.user.id, u.id);
        return {
          ...publicView(u),
          solvedAt: u.solved_at,
          puzzle: mine ? { status: mine.status, revealed: JSON.parse(mine.revealed) } : null,
        };
      }),
  });
});

export default router;
