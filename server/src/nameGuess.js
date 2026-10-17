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

const lower = (s) => s.toLowerCase();

/** Positions where two same-length names have the same letter. */
function sharedPositions(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i++) if (lower(a[i]) === lower(b[i])) out.push(i);
  return out;
}

/**
 * "Rohan" with positions [0, 4] -> "R _ _ _ n". With `showLength` false only the first
 * letter shows ("S …"), for names that have no same-length look-alike.
 */
export function maskName(name, reveal, showLength = true) {
  const n = firstName(name);
  if (!showLength) return `${n[0]} …`;
  return [...n].map((ch, i) => (reveal.includes(i) ? ch : '_')).join(' ');
}

/** Does `name` fit a hint that shows `real`'s letters at `reveal` (and its length, if shown)? */
export const fitsHint = (name, real, reveal, showLength = true) =>
  (!showLength || name.length === real.length) && reveal.every((i) => lower(name[i]) === lower(real[i]));

/**
 * Build one round. A little challenging, not a giveaway:
 * - a look-alike name of the same length always fits the hint too, because only the
 *   letters both names share are shown (e.g. Rohan / Rajan -> "R _ _ _ n");
 * - the other options look similar (same first letter where possible) but don't fit.
 * So a careless pick usually fails and a careful one is about 50/50.
 */
export function buildNameGuess(target) {
  const real = firstName(target.name);
  const pool = [
    ...new Set(
      (target.gender === 'male' || target.gender === 'female'
        ? CATALOG.names[target.gender]
        : [...CATALOG.names.female, ...CATALOG.names.male]
      ).filter((n) => lower(n) !== lower(real)),
    ),
  ];

  let twin = pool
    .filter((n) => n.length === real.length)
    .map((n) => [(lower(n[0]) === lower(real[0]) ? 100 : 0) + sharedPositions(real, n).length * 10 + Math.random(), n])
    .sort((a, b) => b[0] - a[0])[0]?.[1];

  // Reveal at most about a third of the letters, and only ones the look-alike shares.
  const maxReveal = Math.max(1, Math.floor(real.length / 3));
  let reveal = [0];
  let showLength = true;
  if (twin) {
    const shared = sharedPositions(real, twin);
    reveal = shared.includes(0)
      ? [0, ...shuffle(shared.filter((i) => i > 0)).slice(0, maxReveal - 1)]
      : shuffle(shared).slice(0, maxReveal);
  } else {
    // Unusual length: hide the length and use a same-first-letter name as the look-alike.
    twin = shuffle(pool.filter((n) => lower(n[0]) === lower(real[0])))[0];
    showLength = !twin;
  }

  const others = pool
    .filter((n) => n !== twin && !fitsHint(n, real, reveal, showLength))
    .map((n) => [(lower(n[0]) === lower(real[0]) ? 2 : 0) + (Math.abs(n.length - real.length) <= 1 ? 1 : 0) + Math.random(), n])
    .sort((a, b) => b[0] - a[0])
    .slice(0, NAME_GUESS.options - 1 - (twin ? 1 : 0))
    .map(([, n]) => n);

  const options = shuffle([real, ...(twin ? [twin] : []), ...others]);
  return { mask: maskName(real, reveal, showLength), options, answer: options.indexOf(real) };
}
