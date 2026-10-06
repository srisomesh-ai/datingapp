// Guess the name -> earn a coin -> like (with one message if you guessed right) -> match.
import { NAME_GUESS } from './config.js';
import { one, run, tx } from './db.js';
import { buildNameGuess } from './nameGuess.js';
import { HttpError } from './util.js';

export function getGuess(visitorId, targetId) {
  return one('SELECT * FROM name_guesses WHERE visitor_id = ? AND target_id = ?', visitorId, targetId);
}

/** The round for this pair, created on first view so the options never change. */
export function ensureGuess(visitorId, target) {
  const existing = getGuess(visitorId, target.id);
  if (existing) return existing;
  const g = buildNameGuess(target);
  run(
    'INSERT OR IGNORE INTO name_guesses (visitor_id, target_id, mask, options, answer) VALUES (?, ?, ?, ?, ?)',
    visitorId,
    target.id,
    g.mask,
    JSON.stringify(g.options),
    g.answer,
  );
  return getGuess(visitorId, target.id);
}

/** Shape sent to the visitor: never includes the answer while the round is open. */
export function guessView(g) {
  if (!g) return null;
  const view = { mask: g.mask, options: JSON.parse(g.options), status: g.status };
  if (g.status !== 'pending') {
    view.correctOption = g.answer;
    view.coinsAwarded = g.coins_awarded;
  }
  return view;
}

export const hasLiked = (fromId, toId) => Boolean(one('SELECT 1 FROM likes WHERE from_id = ? AND to_id = ?', fromId, toId));

/** Matched = liked each other. Matches can chat freely and call for free. */
export const isMatched = (a, b) => hasLiked(a, b) && hasLiked(b, a);

/** Whether the viewer may see this person's name (otherwise only the masked hint). */
export function nameKnown(viewerId, target) {
  if (viewerId === target.id || target.is_host) return true;
  if (hasLiked(target.id, viewerId)) return true; // they liked you: you see who it was
  const g = getGuess(viewerId, target.id);
  return Boolean(g && g.status !== 'pending');
}

export function submitGuess(visitorId, targetId, optionIndex) {
  return tx(() => {
    const g = getGuess(visitorId, targetId);
    if (!g) throw new HttpError(404, 'Open their profile first');
    if (g.status !== 'pending') throw new HttpError(409, 'You already guessed this name');
    const options = JSON.parse(g.options);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
      throw new HttpError(400, 'Invalid option');
    }
    const correct = optionIndex === g.answer;
    let coins = 0;
    if (correct) {
      const today = one(
        `SELECT COALESCE(SUM(coins_awarded), 0) AS n FROM name_guesses
         WHERE visitor_id = ? AND guessed_at >= datetime('now', 'start of day')`,
        visitorId,
      ).n;
      coins = today + NAME_GUESS.coinsPerCorrect <= NAME_GUESS.dailyCoinLimit ? NAME_GUESS.coinsPerCorrect : 0;
      if (coins) {
        run('UPDATE users SET coins = coins + ? WHERE id = ?', coins, visitorId);
        run(
          "INSERT INTO transactions (user_id, account, type, amount_paise, ref_type, ref_id) VALUES (?, 'coins', 'name_guess', ?, 'user', ?)",
          visitorId,
          coins,
          targetId,
        );
      }
    }
    run(
      "UPDATE name_guesses SET status = ?, coins_awarded = ?, guessed_at = CURRENT_TIMESTAMP WHERE visitor_id = ? AND target_id = ?",
      correct ? 'correct' : 'wrong',
      coins,
      visitorId,
      targetId,
    );
    return { ...guessView(getGuess(visitorId, targetId)), dailyLimitReached: correct && !coins };
  });
}

/**
 * Like someone. A correct guess lets the like carry one intro message, which becomes
 * the first message of the chat if they like back.
 * @returns {{matched: boolean}}
 */
export function likeUser(fromId, toId, message) {
  return tx(() => {
    if (hasLiked(fromId, toId)) throw new HttpError(409, 'You already liked this person');
    const g = getGuess(fromId, toId);
    const theyLikedMe = hasLiked(toId, fromId);
    let body = null;
    if (message != null && String(message).trim()) {
      if (g?.status !== 'correct') throw new HttpError(403, 'Guess their name right to send a message');
      body = String(message).trim().slice(0, NAME_GUESS.messageMaxLength);
    }
    run('INSERT INTO likes (from_id, to_id, message) VALUES (?, ?, ?)', fromId, toId, body);
    if (body) run('INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)', fromId, toId, body);
    if (theyLikedMe) run('UPDATE likes SET declined = 0 WHERE from_id = ? AND to_id = ?', toId, fromId);
    return { matched: theyLikedMe };
  });
}

export function declineLike(meId, fromId) {
  run('UPDATE likes SET declined = 1 WHERE from_id = ? AND to_id = ?', fromId, meId);
}
