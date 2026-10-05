// In-browser fake backend for the static demo build (VITE_DEMO=1). It mirrors the
// real API's shapes and rules closely enough to test every screen without a server.
import {
  CATALOG, ICE_SERVERS, PACKAGES, PAYG_RATES, PLATFORM_FEE_PERCENT, PROFILE_MIN, PUZZLE, TILE_COUNT,
} from '../../../server/src/config.js';
import { generateQuestions, shuffle } from '../../../server/src/puzzleQuestions.js';
import { REPLIES, demoPhoto, makePeople } from './demoData.js';
import { emitToClient } from './demoSocket.js';

const KEY = 'demo-state-v1';
const ME = 1;
const now = () => new Date().toISOString();

function fresh() {
  return { me: null, mePhoto: null, people: makePeople(), attempts: {}, messages: [], skips: [], blocked: [], walletPaise: 500_00, earningsPaise: 0, lots: [], tx: [{ id: 1, account: 'wallet', type: 'topup', amountPaise: 500_00, note: 'Demo credit', createdAt: now() }], calls: [], withdrawals: [], seq: 100 };
}

let state;
try {
  state = JSON.parse(localStorage.getItem(KEY)) ?? fresh();
} catch {
  state = fresh();
}
export const demoState = () => state;
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: demo keeps working in memory */
  }
}
const nextId = () => ++state.seq;

class DemoError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
const fail = (status, message, data) => {
  throw new DemoError(status, message, data);
};

// ---- views (same shapes as the server) --------------------------------

function age(dob) {
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

function selfView() {
  const m = state.me;
  return {
    ...m,
    age: age(m.dob),
    hasPhoto: Boolean(state.mePhoto),
    photoVersion: 1,
    walletPaise: state.walletPaise,
    earningsPaise: state.earningsPaise,
    isAdmin: false,
    profileComplete: Boolean(
      state.mePhoto && m.hobbies.length >= PROFILE_MIN.hobbies && m.likes.length >= PROFILE_MIN.likes &&
        m.favoriteCuisine && m.weekendStyle && m.chronotype && m.dreamDestination,
    ),
  };
}

const solved = (id) => state.attempts[id]?.status === 'solved';

function publicView(p, revealed = solved(p.id)) {
  const base = { id: p.id, name: p.name, gender: p.gender, age: age(p.dob), city: p.city, bio: p.bio, lookingFor: p.looking_for, hasPhoto: true, photoVersion: 1, revealed };
  if (!revealed) return base;
  return { ...base, hobbies: p.hobbies, likes: p.likes, favoriteCuisine: p.favorite_cuisine, weekendStyle: p.weekend_style, chronotype: p.chronotype, dreamDestination: p.dream_destination };
}

const person = (id) => state.people.find((p) => p.id === Number(id)) ?? fail(404, 'User not found');
// Same rule as the server: listed friends' photos are public, others need a solved puzzle.
const canSeePhoto = (p) => p.is_host || solved(p.id);
const rateFor = (gender) => {
  const key = PAYG_RATES[gender] ? gender : 'other';
  const r = PAYG_RATES[key];
  return { rateKey: key, ...r, paisePerMinute: Math.round(r.pricePaise / r.minutes) };
};
export function packageMinutes() {
  const out = {};
  for (const l of state.lots) if (l.minutesLeft > 0) out[l.rateKey] = (out[l.rateKey] ?? 0) + l.minutesLeft;
  return out;
}
export const affordable = (rate) => (packageMinutes()[rate.rateKey] ?? 0) + Math.floor(state.walletPaise / rate.paisePerMinute);
export function ledger(account, type, amountPaise, note) {
  state.tx.unshift({ id: nextId(), account, type, amountPaise, note, createdAt: now() });
}

function puzzleState(a, lastResult) {
  const q = a.status === 'in_progress' ? a.questions[a.current] : null;
  return {
    attemptId: a.id, targetId: a.targetId, status: a.status, correct: a.correct, wrong: a.wrong,
    correctToSolve: PUZZLE.correctToSolve, maxWrong: PUZZLE.maxWrong, totalQuestions: a.questions.length,
    questionNumber: a.current + 1, revealed: a.revealed, grid: PUZZLE.grid,
    question: q ? { index: a.current, prompt: q.prompt, options: q.options } : null,
    ...(a.status === 'failed' ? { retryAt: new Date(new Date(a.updatedAt).getTime() + PUZZLE.cooldownHours * 3600e3).toISOString() } : {}),
    ...(lastResult ? { lastResult } : {}),
  };
}

const messageView = (m) => m;

function walletSummary() {
  return { walletPaise: state.walletPaise, earningsPaise: state.earningsPaise, packageMinutes: packageMinutes(), lots: state.lots.filter((l) => l.minutesLeft > 0), paymentsMode: 'mock' };
}

// ---- routes -------------------------------------------------------------

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/?]+)')}(?:\\?.*)?$`), fn });
const requireMe = () => state.me ?? fail(401, 'Please log in');

route('GET', '/meta', () => ({
  catalog: CATALOG, profileMin: PROFILE_MIN, puzzle: PUZZLE, rates: PAYG_RATES, packages: PACKAGES,
  platformFeePercent: PLATFORM_FEE_PERCENT, payments: { mode: 'mock', razorpayKeyId: null }, iceServers: ICE_SERVERS, demo: true,
}));

route('GET', '/auth/me', () => ({ user: selfView(requireMe()) }));

function createMe(b) {
  state.me = {
    id: ME, email: (b.email ?? 'you@demo.app').toLowerCase(), phone: b.phone ?? null, name: b.name || 'You', gender: b.gender ?? 'female',
    interestedIn: 'everyone', lookingFor: 'both', dob: b.dob || '1998-01-01', city: '', bio: '', hobbies: [], likes: [],
    favoriteCuisine: null, weekendStyle: null, chronotype: null, dreamDestination: null, isHost: false, hostAvailable: false, hostHeadline: '',
  };
}

route('POST', '/auth/register', (b) => {
  if (!b.name?.trim()) fail(400, 'Name is required');
  if (!b.dob || age(b.dob) < 18) fail(400, 'You must be 18 or older to join');
  if ((b.password ?? '').length < 8) fail(400, 'Password must be 8-200 characters');
  Object.assign(state, fresh());
  createMe(b);
  return { user: selfView() };
});
route('POST', '/auth/login', (b) => {
  if (!state.me) createMe({ ...b, name: b.email?.split('@')[0] });
  return { user: selfView() };
});
route('POST', '/auth/logout', () => {
  Object.assign(state, fresh());
  return { ok: true };
});

route('GET', '/profile', () => ({ user: selfView(requireMe()) }));
route('PUT', '/profile', (b) => {
  requireMe();
  const keys = ['name', 'bio', 'city', 'interestedIn', 'lookingFor', 'hobbies', 'likes', 'favoriteCuisine', 'weekendStyle', 'chronotype', 'dreamDestination'];
  for (const k of keys) if (b[k] !== undefined) state.me[k] = b[k];
  return { user: selfView() };
});
route('POST', '/profile/photo', async (form) => {
  requireMe();
  const blob = form.get('full');
  state.mePhoto = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
  return { user: selfView() };
});

route('GET', '/users/:id', (_b, { id }) => {
  const p = person(id);
  return { user: publicView(p), canSeePhoto: canSeePhoto(p), revealedTiles: solved(p.id) ? [...Array(TILE_COUNT).keys()] : (state.attempts[p.id]?.revealed ?? []) };
});
route('POST', '/users/:id/block', (_b, { id }) => {
  state.blocked.push(Number(id));
  return { ok: true };
});
route('POST', '/users/:id/report', () => ({ ok: true }));

route('GET', '/discover', () => {
  const me = requireMe();
  const profiles = state.people
    .filter((p) => !state.blocked.includes(p.id) && !state.skips.includes(p.id) && !solved(p.id) && state.attempts[p.id]?.status !== 'failed')
    .filter((p) => me.interestedIn === 'everyone' || p.gender === me.interestedIn)
    .map((p) => ({ ...publicView(p), puzzle: state.attempts[p.id] ? { status: state.attempts[p.id].status, revealed: state.attempts[p.id].revealed } : null }));
  return { profiles: shuffle(profiles), rules: PUZZLE };
});
route('POST', '/discover/:id/skip', (_b, { id }) => {
  state.skips.push(Number(id));
  return { ok: true };
});
route('POST', '/discover/:id/puzzle', (_b, { id }) => {
  if (!selfView().profileComplete) fail(412, 'Complete your profile (photo, hobbies, likes) to play puzzles');
  const p = person(id);
  let a = state.attempts[p.id];
  if (a?.status === 'failed') fail(429, 'You can retry this puzzle later', { puzzle: puzzleState(a) });
  if (!a) {
    a = { id: nextId(), targetId: p.id, questions: generateQuestions(p), current: 0, correct: 0, wrong: 0, revealed: [], status: 'in_progress', updatedAt: now() };
    state.attempts[p.id] = a;
  }
  return { puzzle: puzzleState(a), profile: publicView(p) };
});
route('POST', '/puzzles/:attemptId/answer', (b, { attemptId }) => {
  const a = Object.values(state.attempts).find((x) => x.id === Number(attemptId)) ?? fail(404, 'Puzzle not found');
  if (a.status !== 'in_progress') fail(409, 'This puzzle is already finished');
  if (b.questionIndex !== a.current) fail(409, 'That question was already answered');
  const q = a.questions[a.current];
  const isCorrect = b.optionIndex === q.answer;
  const hidden = [...Array(TILE_COUNT).keys()].filter((t) => !a.revealed.includes(t));
  let newly = [];
  if (isCorrect) {
    a.correct++;
    newly = shuffle(hidden).slice(0, PUZZLE.tilesPerCorrect);
  } else a.wrong++;
  if (a.correct >= PUZZLE.correctToSolve) {
    a.status = 'solved';
    newly = hidden;
  } else if (a.wrong >= PUZZLE.maxWrong || a.current + 1 >= a.questions.length) a.status = 'failed';
  a.revealed = [...a.revealed, ...newly].sort((x, y) => x - y);
  a.current++;
  a.updatedAt = now();
  const p = person(a.targetId);
  return { puzzle: puzzleState(a, { correct: isCorrect, correctOption: q.answer, newlyRevealed: newly }), profile: a.status === 'solved' ? publicView(p, true) : undefined };
});
route('GET', '/admirers', () => ({ admirers: [] }));

const thread = (id) => state.messages.filter((m) => m.senderId === id || m.receiverId === id);
route('GET', '/conversations', () => ({
  conversations: state.people
    .filter((p) => solved(p.id) && !state.blocked.includes(p.id))
    .map((p) => {
      const t = thread(p.id);
      const last = t[t.length - 1];
      return { user: publicView(p), canSeePhoto: canSeePhoto(p), online: p.online, lastMessage: last?.body ?? null, lastAt: last?.createdAt ?? null, unread: t.filter((m) => m.senderId === p.id && !m.readAt).length };
    })
    .sort((x, y) => (y.lastAt ?? '').localeCompare(x.lastAt ?? '')),
}));
route('GET', '/messages/:id', (_b, { id }) => {
  const p = person(id);
  return { user: publicView(p), canSeePhoto: canSeePhoto(p), canMessage: solved(p.id) && !state.blocked.includes(p.id), online: p.online, messages: thread(p.id).map(messageView) };
});
route('POST', '/messages/:id', (b, { id }) => {
  const p = person(id);
  if (!solved(p.id)) fail(403, 'Solve their photo puzzle to unlock messaging');
  const msg = { id: nextId(), senderId: ME, receiverId: p.id, body: b.body.trim(), readAt: null, createdAt: now() };
  state.messages.push(msg);
  // The other person "types" a reply.
  setTimeout(() => {
    msg.readAt = now();
    const reply = { id: nextId(), senderId: p.id, receiverId: ME, body: REPLIES[thread(p.id).length % REPLIES.length], readAt: null, createdAt: now() };
    state.messages.push(reply);
    save();
    emitToClient('message:new', { message: reply, from: publicView(p) });
  }, 2500);
  return { message: msg };
});
route('POST', '/messages/:id/read', (_b, { id }) => {
  for (const m of thread(Number(id))) if (m.senderId === Number(id)) m.readAt ??= now();
  return { ok: true };
});

export function hostStatus(p) {
  if (!p.host_available || !p.online) return 'offline';
  return 'available';
}
route('GET', '/friends', (_b, _p, url) => {
  const g = new URLSearchParams(url.split('?')[1] ?? '').get('gender');
  const order = { available: 0, busy: 1, offline: 2 };
  return {
    friends: state.people
      .filter((p) => p.is_host && (!g || p.gender === g) && !state.blocked.includes(p.id))
      .map((p) => {
        const rate = rateFor(p.gender);
        return { ...publicView(p), headline: p.host_headline, status: hostStatus(p), rate, affordableMinutes: affordable(rate) };
      })
      .sort((x, y) => order[x.status] - order[y.status]),
  };
});
route('PUT', '/friends/me', (b) => {
  if (b.isHost !== undefined) {
    if (b.isHost && !selfView().profileComplete) fail(412, 'Complete your profile before becoming a friend');
    state.me.isHost = b.isHost;
    if (!b.isHost) state.me.hostAvailable = false;
  }
  if (b.hostAvailable !== undefined) state.me.hostAvailable = b.hostAvailable;
  if (b.hostHeadline !== undefined) state.me.hostHeadline = b.hostHeadline;
  return { user: selfView() };
});
route('GET', '/calls', () => ({ calls: state.calls }));

route('GET', '/wallet', () => ({ ...walletSummary(), transactions: state.tx.slice(0, 100), withdrawals: state.withdrawals }));
route('GET', '/packages', () => ({ packages: PACKAGES }));
route('POST', '/wallet/topup/order', (b) => {
  const amountPaise = Math.round(Number(b.amountRupees) * 100);
  if (!(amountPaise >= 50_00 && amountPaise <= 50_000_00)) fail(400, 'Top-up must be between ₹50 and ₹50000');
  return { provider: 'mock', orderId: `demo_${amountPaise}_${nextId()}`, amountPaise, currency: 'INR', keyId: null };
});
route('POST', '/wallet/topup/verify', (b) => {
  const amountPaise = Number(b.orderId.split('_')[1]);
  state.walletPaise += amountPaise;
  ledger('wallet', 'topup', amountPaise);
  return walletSummary();
});
route('POST', '/packages/:id/buy', (_b, { id }) => {
  const pkg = PACKAGES.find((p) => p.id === id) ?? fail(404, 'Package not found');
  if (state.walletPaise < pkg.pricePaise) fail(402, 'Not enough wallet balance. Please add money first.');
  state.walletPaise -= pkg.pricePaise;
  state.lots.push({ id: nextId(), packageId: pkg.id, rateKey: pkg.rateKey, minutesTotal: pkg.minutes, minutesLeft: pkg.minutes, paisePerMinute: pkg.paisePerMinute });
  ledger('wallet', 'package_purchase', -pkg.pricePaise, `${pkg.minutes} min package`);
  return walletSummary();
});
route('POST', '/wallet/withdraw', (b) => {
  const amountPaise = Math.round(Number(b.amountRupees) * 100);
  if (!(amountPaise >= 100_00)) fail(400, 'Minimum withdrawal is ₹100');
  if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(b.upiId ?? '')) fail(400, 'Enter a valid UPI ID (e.g. name@bank)');
  if (amountPaise > state.earningsPaise) fail(402, 'Amount exceeds your earnings');
  state.earningsPaise -= amountPaise;
  state.withdrawals.unshift({ id: nextId(), amountPaise, upiId: b.upiId, status: 'pending', createdAt: now() });
  ledger('earnings', 'withdrawal', -amountPaise);
  return walletSummary();
});

/** Entry point used by api() in demo builds. */
export async function demoApi(path, { method = 'GET', body } = {}) {
  await new Promise((r) => setTimeout(r, 120)); // feel like a network
  for (const r of routes) {
    const m = r.method === method && path.match(r.re);
    if (m) {
      try {
        const result = await r.fn(body ?? {}, m.groups ?? {}, path);
        save();
        return result;
      } catch (err) {
        if (err instanceof DemoError) throw err;
        console.error(err);
        throw new DemoError(500, 'Something went wrong');
      }
    }
  }
  throw new DemoError(404, 'Not found');
}

export function demoPhotoUrl(user, part) {
  if (user.id === ME) return state.mePhoto ?? '';
  const p = state.people.find((x) => x.id === user.id);
  return p ? demoPhoto(p, part) : '';
}

export { publicView as demoPublicView, rateFor, person as demoPerson, nextId as demoNextId, now as demoNow };
