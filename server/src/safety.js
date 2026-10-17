// Women-first safety rules: who may guess you, how many new chats can open per day,
// and "people who tried to guess your name".
import { SAFETY } from './config.js';
import { all, one } from './db.js';
import { ageFromDob } from './util.js';

/** New chats others may open with this user per day (their setting, or the default for their gender). */
export const dailyChatLimit = (u) => u.daily_chat_limit ?? SAFETY.defaultDailyChats[u.gender] ?? SAFETY.defaultDailyChats.other;

/** Chats others opened with this user today by guessing their name. */
export function newChatsToday(userId) {
  return one(
    `SELECT COUNT(*) AS n FROM connections
     WHERE (user_a = ? OR user_b = ?) AND guesser_id != ? AND via = 'guess' AND created_at >= datetime('now', 'start of day')`,
    userId,
    userId,
    userId,
  ).n;
}

export const chatLimitReached = (u) => newChatsToday(u.id) >= dailyChatLimit(u);

/** Is the visitor inside the target's "who can guess me" age range? */
export function ageAllowed(target, visitor) {
  const age = ageFromDob(visitor.dob);
  if (target.guess_min_age != null && age < target.guess_min_age) return false;
  if (target.guess_max_age != null && age > target.guess_max_age) return false;
  return true;
}

/** Whether `visitor` may see and guess `target` right now; returns a reason when not. */
export function guessBlockedReason(target, visitor) {
  if (!ageAllowed(target, visitor)) return 'not_in_range';
  if (chatLimitReached(target)) return 'daily_limit';
  return null;
}

/** "N people tried to guess your name today, M got it right." */
export function guessStats(userId) {
  const row = (since) =>
    one(
      `SELECT COUNT(*) AS tried, COALESCE(SUM(status = 'correct'), 0) AS correct FROM name_guesses
       WHERE target_id = ? AND status != 'pending' AND guessed_at >= datetime('now', ?)`,
      userId,
      since,
    );
  const today = one(
    `SELECT COUNT(*) AS tried, COALESCE(SUM(status = 'correct'), 0) AS correct FROM name_guesses
     WHERE target_id = ? AND status != 'pending' AND guessed_at >= datetime('now', 'start of day')`,
    userId,
  );
  return { today, week: row(`-${SAFETY.whoTriedDays} days`) };
}

/** People who guessed this user's name wrong recently and aren't connected or blocked. */
export function whoTried(userId) {
  return all(
    `SELECT u.*, g.guessed_at FROM name_guesses g JOIN users u ON u.id = g.visitor_id
     WHERE g.target_id = ? AND g.status = 'wrong' AND g.guessed_at >= datetime('now', ?) AND u.is_banned = 0
       AND NOT EXISTS (SELECT 1 FROM connections c WHERE (c.user_a = u.id AND c.user_b = ?) OR (c.user_a = ? AND c.user_b = u.id))
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
     ORDER BY g.guessed_at DESC LIMIT 100`,
    userId,
    `-${SAFETY.whoTriedDays} days`,
    userId,
    userId,
    userId,
    userId,
  );
}
