// "Guess to reveal" puzzle: answer questions about someone's hobbies and likes;
// every correct answer uncovers more tiles of their photo. Answers never leave the server.
import { PUZZLE, TILE_COUNT } from './config.js';
import { one, run, tx } from './db.js';
import { HttpError, shuffle } from './util.js';
import { generateQuestions as buildQuestions } from './puzzleQuestions.js';

const pick = (arr, n) => shuffle(arr).slice(0, n);

export function generateQuestions(target, count = PUZZLE.questions) {
  const questions = buildQuestions(target, count);
  if (questions.length < count) throw new HttpError(409, 'This profile is not ready for puzzles yet');
  return questions;
}


/** Shape sent to the visitor: no answers, only the current question. */
export function puzzleState(attempt, { lastResult } = {}) {
  const questions = JSON.parse(attempt.questions);
  const q = attempt.status === 'in_progress' ? questions[attempt.current_index] : null;
  const state = {
    attemptId: attempt.id,
    targetId: attempt.target_id,
    status: attempt.status,
    correct: attempt.correct,
    wrong: attempt.wrong,
    correctToSolve: PUZZLE.correctToSolve,
    maxWrong: PUZZLE.maxWrong,
    totalQuestions: questions.length,
    questionNumber: attempt.current_index + 1,
    revealed: JSON.parse(attempt.revealed),
    grid: PUZZLE.grid,
    question: q ? { index: attempt.current_index, prompt: q.prompt, options: q.options } : null,
  };
  if (attempt.status === 'failed') state.retryAt = retryAt(attempt);
  if (lastResult) state.lastResult = lastResult;
  return state;
}

function retryAt(attempt) {
  const t = new Date(attempt.updated_at.replace(' ', 'T') + 'Z').getTime();
  return new Date(t + PUZZLE.cooldownHours * 3600 * 1000).toISOString();
}

export function latestAttempt(visitorId, targetId) {
  return one('SELECT * FROM puzzle_attempts WHERE visitor_id = ? AND target_id = ? ORDER BY id DESC LIMIT 1', visitorId, targetId);
}

export function hasSolved(visitorId, targetId) {
  return Boolean(
    one("SELECT 1 FROM puzzle_attempts WHERE visitor_id = ? AND target_id = ? AND status = 'solved'", visitorId, targetId),
  );
}

/** Two people may chat / call for free once either has solved the other's puzzle. */
export function areConnected(a, b) {
  return hasSolved(a, b) || hasSolved(b, a);
}

/** Tiles of target's photo the viewer may load. */
export function revealedTiles(viewerId, targetId) {
  if (viewerId === targetId) return allTiles();
  const attempt = latestAttempt(viewerId, targetId);
  if (!attempt) return [];
  if (attempt.status === 'solved') return allTiles();
  return JSON.parse(attempt.revealed);
}

const allTiles = () => Array.from({ length: TILE_COUNT }, (_, i) => i);

export function startPuzzle(visitor, target) {
  const existing = latestAttempt(visitor.id, target.id);
  if (existing) {
    if (existing.status !== 'failed') return existing;
    if (Date.now() < new Date(retryAt(existing)).getTime()) {
      throw new HttpError(429, 'You can retry this puzzle later', { puzzle: puzzleState(existing) });
    }
  }
  const questions = generateQuestions(target);
  // Keep tiles uncovered by a previous failed attempt — progress is never taken away.
  const revealed = existing ? existing.revealed : '[]';
  const { lastInsertRowid } = run(
    'INSERT INTO puzzle_attempts (visitor_id, target_id, questions, revealed) VALUES (?, ?, ?, ?)',
    visitor.id,
    target.id,
    JSON.stringify(questions),
    revealed,
  );
  return one('SELECT * FROM puzzle_attempts WHERE id = ?', lastInsertRowid);
}

export function answerPuzzle(visitorId, attemptId, questionIndex, optionIndex) {
  return tx(() => {
    const attempt = one('SELECT * FROM puzzle_attempts WHERE id = ? AND visitor_id = ?', attemptId, visitorId);
    if (!attempt) throw new HttpError(404, 'Puzzle not found');
    if (attempt.status !== 'in_progress') throw new HttpError(409, 'This puzzle is already finished');
    if (questionIndex !== attempt.current_index) throw new HttpError(409, 'That question was already answered');

    const questions = JSON.parse(attempt.questions);
    const q = questions[attempt.current_index];
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length) {
      throw new HttpError(400, 'Invalid option');
    }

    const isCorrect = optionIndex === q.answer;
    let { correct, wrong } = attempt;
    let revealed = JSON.parse(attempt.revealed);
    let newlyRevealed = [];
    if (isCorrect) {
      correct++;
      const hidden = allTiles().filter((t) => !revealed.includes(t));
      newlyRevealed = pick(hidden, PUZZLE.tilesPerCorrect);
    } else {
      wrong++;
    }

    let status = 'in_progress';
    if (correct >= PUZZLE.correctToSolve) {
      status = 'solved';
      newlyRevealed = allTiles().filter((t) => !revealed.includes(t));
    } else if (wrong >= PUZZLE.maxWrong || attempt.current_index + 1 >= questions.length) {
      status = 'failed';
    }
    revealed = [...revealed, ...newlyRevealed].sort((a, b) => a - b);

    run(
      `UPDATE puzzle_attempts SET current_index = ?, correct = ?, wrong = ?, revealed = ?, status = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      attempt.current_index + 1,
      correct,
      wrong,
      JSON.stringify(revealed),
      status,
      attempt.id,
    );
    const updated = one('SELECT * FROM puzzle_attempts WHERE id = ?', attempt.id);
    return puzzleState(updated, {
      lastResult: { correct: isCorrect, correctOption: q.answer, newlyRevealed },
    });
  });
}
