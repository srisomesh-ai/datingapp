// Pure puzzle-question generation (no DB), shared by the server and the browser demo build.
import { CATALOG, PUZZLE } from './config.js';

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

const pick = (arr, n) => shuffle(arr).slice(0, n);

function choiceQuestion(prompt, correct, pool, optionCount = 4) {
  const decoys = pick(
    pool.filter((x) => x !== correct),
    optionCount - 1,
  );
  const options = shuffle([correct, ...decoys]);
  return { prompt, options, answer: options.indexOf(correct) };
}

/** Question builders; each returns null when the profile can't support it. */
const BUILDERS = {
  hobby(u) {
    const hobbies = parseList(u.hobbies);
    if (!hobbies.length) return null;
    const pool = CATALOG.hobbies.filter((h) => !hobbies.includes(h));
    return choiceQuestion(`Which of these is one of ${u.name}'s hobbies?`, pick(hobbies, 1)[0], pool);
  },
  notHobby(u) {
    const hobbies = parseList(u.hobbies);
    if (hobbies.length < 3) return null;
    const decoy = pick(CATALOG.hobbies.filter((h) => !hobbies.includes(h)), 1)[0];
    const options = shuffle([decoy, ...pick(hobbies, 3)]);
    return { prompt: `Which of these is NOT a hobby of ${u.name}?`, options, answer: options.indexOf(decoy) };
  },
  like(u) {
    const likes = parseList(u.likes);
    if (!likes.length) return null;
    const pool = CATALOG.likes.filter((l) => !likes.includes(l));
    return choiceQuestion(`${u.name} is totally into one of these. Which one?`, pick(likes, 1)[0], pool);
  },
  cuisine(u) {
    if (!u.favorite_cuisine) return null;
    return choiceQuestion(`What's ${u.name}'s favourite cuisine?`, u.favorite_cuisine, CATALOG.cuisines);
  },
  weekend(u) {
    if (!u.weekend_style) return null;
    return choiceQuestion(`How does ${u.name} love to spend a weekend?`, u.weekend_style, CATALOG.weekendStyles);
  },
  chronotype(u) {
    if (!u.chronotype) return null;
    return choiceQuestion(`Is ${u.name} a morning person or a night owl?`, u.chronotype, CATALOG.chronotypes, 2);
  },
  destination(u) {
    if (!u.dream_destination) return null;
    return choiceQuestion(`Where would ${u.name} rather go on holiday?`, u.dream_destination, CATALOG.destinations);
  },
};

export function generateQuestions(target, count = PUZZLE.questions) {
  // Prefer the "core" hobby/like questions, then fill with the rest.
  const core = shuffle(['hobby', 'like']);
  const rest = shuffle(Object.keys(BUILDERS).filter((k) => !core.includes(k)));
  const questions = [];
  for (const key of [...core, ...rest]) {
    if (questions.length >= count) break;
    const q = BUILDERS[key](target);
    if (q) questions.push({ type: key, ...q });
  }
  // Callers treat a short list as "profile not ready".
  return questions;
}
