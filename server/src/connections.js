// See a photo -> guess the name -> right guess connects you both (chat opens) + 1 coin.
// A wrong guess can be retried after NAME_GUESS.retryHours.
import { NAME_GUESS } from './config.js';
import { one, run, tx } from './db.js';
import { buildNameGuess } from './nameGuess.js';
import { HttpError } from './util.js';

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export function getGuess(visitorId, targetId) {
  return one('SELECT * FROM name_guesses WHERE visitor_id = ? AND target_id = ?', visitorId, targetId);
}

const retryOpen = (g) =>
  g.status === 'wrong' && Date.now() - new Date(g.guessed_at.replace(' ', 'T') + 'Z').getTime() >= NAME_GUESS.retryHours * 3600e3;

/** The round for this pair. Options stay fixed until it's guessed; a wrong guess gets a fresh round after the wait. */
export function ensureGuess(visitorId, target) {
  const existing = getGuess(visitorId, target.id);
  if (existing && !retryOpen(existing)) return existing;
  const g = buildNameGuess(target);
  run(
    `INSERT INTO name_guesses (visitor_id, target_id, mask, options, answer) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (visitor_id, target_id) DO UPDATE SET mask = excluded.mask, options = excluded.options,
       answer = excluded.answer, status = 'pending', coins_awarded = 0, guessed_at = NULL, created_at = CURRENT_TIMESTAMP`,
    visitorId,
    target.id,
    g.mask,
    JSON.stringify(g.options),
    g.answer,
  );
  return getGuess(visitorId, target.id);
}

/** Shape sent to the visitor. The answer is never revealed (a wrong guess may be retried later). */
export function guessView(g) {
  if (!g) return null;
  const view = { mask: g.mask, options: JSON.parse(g.options), status: g.status };
  if (g.status === 'correct') {
    view.correctOption = g.answer;
    view.coinsAwarded = g.coins_awarded;
  }
  if (g.status === 'wrong') {
    view.retryAt = new Date(new Date(g.guessed_at.replace(' ', 'T') + 'Z').getTime() + NAME_GUESS.retryHours * 3600e3).toISOString();
  }
  return view;
}

export function isConnected(a, b) {
  const [x, y] = pair(a, b);
  return Boolean(one('SELECT 1 FROM connections WHERE user_a = ? AND user_b = ?', x, y));
}

export function connectionOf(a, b) {
  const [x, y] = pair(a, b);
  return one('SELECT * FROM connections WHERE user_a = ? AND user_b = ?', x, y);
}

/** Whether the viewer may see this person's name (otherwise only the masked hint). */
export function nameKnown(viewerId, target) {
  return viewerId === target.id || Boolean(target.is_host) || isConnected(viewerId, target.id);
}

/**
 * @returns guess view plus `connected` (true on a right guess) and `dailyLimitReached`.
 */
export function submitGuess(visitorId, targetId, optionIndex) {
  return tx(() => {
    const g = getGuess(visitorId, targetId);
    if (!g) throw new HttpError(404, 'Open their profile first');
    if (g.status === 'correct') throw new HttpError(409, 'You already guessed this name');
    if (g.status === 'wrong') throw new HttpError(429, 'You can try this person again later', { guess: guessView(g) });
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
      const [a, b] = pair(visitorId, targetId);
      run('INSERT OR IGNORE INTO connections (user_a, user_b, guesser_id) VALUES (?, ?, ?)', a, b, visitorId);
    }
    run(
      'UPDATE name_guesses SET status = ?, coins_awarded = ?, guessed_at = CURRENT_TIMESTAMP WHERE visitor_id = ? AND target_id = ?',
      correct ? 'correct' : 'wrong',
      coins,
      visitorId,
      targetId,
    );
    return { ...guessView(getGuess(visitorId, targetId)), connected: correct, dailyLimitReached: correct && !coins };
  });
}
