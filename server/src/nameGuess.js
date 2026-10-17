// Guess-the-name game logic with no DB access, shared by the server and the browser demo build.
import { CATALOG, NAME_GUESS } from './config.js';

export const parseList = (json) => {
  if (Array.isArray(json)) return json;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const firstName = (name) => name.trim().split(/\s+/)[0];

/**
 * Hide some letters of the name as a hint: the first letter always shows, plus
 * about half of the rest. "Ananya" -> "A _ a n _ a".
 */
export function maskName(name) {
  const letters = [...firstName(name)];
  const keep = new Set([0]);
  const extra = shuffle(letters.map((_, i) => i).slice(1)).slice(0, Math.floor((letters.length - 1) / 2));
  extra.forEach((i) => keep.add(i));
  return letters.map((ch, i) => (keep.has(i) ? ch : '_')).join(' ');
}

/**
 * Build one round: the masked name plus shuffled options (the real first name and
 * decoys of the same gender). Guessing is meant to be easy and fun: decoys start
 * with a different letter than the real name, so the hint points to the answer.
 */
export function buildNameGuess(target) {
  const real = firstName(target.name);
  const pool = target.gender === 'male' || target.gender === 'female'
    ? CATALOG.names[target.gender]
    : [...CATALOG.names.female, ...CATALOG.names.male];
  const first = real[0].toLowerCase();
  const decoys = shuffle([...new Set(pool.filter((n) => n.toLowerCase() !== real.toLowerCase()))])
    .sort((a, b) => (a[0].toLowerCase() === first) - (b[0].toLowerCase() === first))
    .slice(0, NAME_GUESS.options - 1);
  const options = shuffle([real, ...decoys]);
  return { mask: maskName(real), options, answer: options.indexOf(real) };
}
