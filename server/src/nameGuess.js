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
 * roughly a third of the rest. "Ananya" -> "A _ _ n _ a".
 */
export function maskName(name) {
  const letters = [...firstName(name)];
  const keep = new Set([0]);
  const extra = shuffle(letters.map((_, i) => i).slice(1)).slice(0, Math.floor((letters.length - 1) / 3));
  extra.forEach((i) => keep.add(i));
  return letters.map((ch, i) => (keep.has(i) ? ch : '_')).join(' ');
}

/**
 * Build one round: the masked name plus shuffled options (the real first name and
 * decoys of the same gender). Decoys prefer the same first letter and a similar
 * length, so the visible letters are the real clue rather than a giveaway.
 */
export function buildNameGuess(target) {
  const real = firstName(target.name);
  const pool = target.gender === 'male' || target.gender === 'female'
    ? CATALOG.names[target.gender]
    : [...CATALOG.names.female, ...CATALOG.names.male];
  const score = (n) =>
    (n[0].toLowerCase() === real[0].toLowerCase() ? 2 : 0) + (Math.abs(n.length - real.length) <= 1 ? 1 : 0) + Math.random();
  const decoys = [...new Set(pool.filter((n) => n.toLowerCase() !== real.toLowerCase()))]
    .map((n) => [score(n), n])
    .sort((a, b) => b[0] - a[0])
    .slice(0, NAME_GUESS.options - 1)
    .map(([, n]) => n);
  const options = shuffle([real, ...decoys]);
  return { mask: maskName(real), options, answer: options.indexOf(real) };
}
