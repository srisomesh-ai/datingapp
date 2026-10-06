// In-browser fake backend for the static demo build (VITE_DEMO=1). It mirrors the
// real API's shapes and rules closely enough to test every screen without a server.
import {
  CATALOG, ICE_SERVERS, NAME_GUESS, PACKAGES, PAYG_RATES, PLATFORM_FEE_PERCENT, PROFILE_MIN, SAMPLE_CALL,
} from '../../../server/src/config.js';
import { buildNameGuess, shuffle } from '../../../server/src/nameGuess.js';
import { REPLIES, demoPhoto, makePeople } from './demoData.js';
import { emitToClient } from './demoSocket.js';

const KEY = 'demo-state-v2';
const ME = 1;
const now = () => new Date().toISOString();

function fresh() {
  const people = makePeople();
  // A couple of people have already liked you, so the Likes section has something to show.
  const likesIn = shuffle(people).slice(0, 2).map((p, i) => ({
    from: p.id,
    message: i === 0 ? `Hi! I guessed your name on the first try 😄` : null,
    at: now(),
    declined: false,
  }));
  return { me: null, mePhoto: null, people, guesses: {}, likesOut: [], likesIn, coins: 10, messages: [], skips: [], blocked: [], walletPaise: 500_00, earningsPaise: 0, lots: [], tx: [{ id: 2, account: 'coins', type: 'demo_bonus', amountPaise: 10, createdAt: now() }, { id: 1, account: 'wallet', type: 'topup', amountPaise: 500_00, note: 'Demo credit', createdAt: now() }], calls: [], withdrawals: [], seq: 100 };
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
    coins: state.coins,
    isAdmin: false,
    profileComplete: Boolean(
      state.mePhoto && m.hobbies.length >= PROFILE_MIN.hobbies && m.likes.length >= PROFILE_MIN.likes,
    ),
  };
}

const likedMe = (id) => state.likesIn.some((l) => l.from === id);
const matched = (id) => state.likesOut.includes(id) && likedMe(id);
const nameKnown = (p) => p.is_host || likedMe(p.id) || (state.guesses[p.id] && state.guesses[p.id].status !== 'pending');

function publicView(p, hideName = !nameKnown(p)) {
  return {
    id: p.id, name: hideName ? null : p.name, nameMask: hideName ? (state.guesses[p.id]?.mask ?? null) : null,
    gender: p.gender, age: age(p.dob), city: p.city, bio: p.bio, lookingFor: p.looking_for, hasPhoto: true, photoVersion: 1,
    hobbies: p.hobbies, likes: p.likes, favoriteCuisine: p.favorite_cuisine, weekendStyle: p.weekend_style,
    chronotype: p.chronotype, dreamDestination: p.dream_destination,
  };
}

const person = (id) => state.people.find((p) => p.id === Number(id)) ?? fail(404, 'User not found');
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

function ensureGuess(p) {
  state.guesses[p.id] ??= { ...buildNameGuess(p), status: 'pending', coinsAwarded: 0 };
  return state.guesses[p.id];
}
function guessView(g) {
  const v = { mask: g.mask, options: g.options, status: g.status };
  if (g.status !== 'pending') Object.assign(v, { correctOption: g.answer, coinsAwarded: g.coinsAwarded });
  return v;
}

const messageView = (m) => m;

function walletSummary() {
  return { walletPaise: state.walletPaise, earningsPaise: state.earningsPaise, coins: state.coins, packageMinutes: packageMinutes(), lots: state.lots.filter((l) => l.minutesLeft > 0), paymentsMode: 'mock' };
}

// ---- routes -------------------------------------------------------------

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/?]+)')}(?:\\?.*)?$`), fn });
const requireMe = () => state.me ?? fail(401, 'Please log in');

route('GET', '/meta', () => ({
  catalog: CATALOG, profileMin: PROFILE_MIN, nameGuess: NAME_GUESS, sampleCall: SAMPLE_CALL, rates: PAYG_RATES, packages: PACKAGES,
  platformFeePercent: PLATFORM_FEE_PERCENT, payments: { mode: 'mock', razorpayKeyId: null }, iceServers: ICE_SERVERS, demo: true,
}));

route('GET', '/ice', () => ({ iceServers: [] }));
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
  return { user: publicView(p), matched: matched(p.id) };
});
route('POST', '/users/:id/block', (_b, { id }) => {
  state.blocked.push(Number(id));
  return { ok: true };
});
route('POST', '/users/:id/report', () => ({ ok: true }));

const requireComplete = () => selfView().profileComplete || fail(412, 'Complete your profile (photo, hobbies, likes) first');

route('GET', '/discover', () => {
  const me = requireMe();
  requireComplete();
  const profiles = state.people
    .filter((p) => !state.blocked.includes(p.id) && !state.skips.includes(p.id) && !state.likesOut.includes(p.id))
    .filter((p) => me.interestedIn === 'everyone' || p.gender === me.interestedIn)
    .map((p) => {
      const g = ensureGuess(p);
      return { ...publicView(p, g.status === 'pending'), guess: guessView(g), likesYou: likedMe(p.id) };
    });
  return { profiles: shuffle(profiles), rules: NAME_GUESS };
});
route('POST', '/discover/:id/skip', (_b, { id }) => {
  state.skips.push(Number(id));
  return { ok: true };
});
route('POST', '/discover/:id/guess', (b, { id }) => {
  requireComplete();
  const p = person(id);
  const g = ensureGuess(p);
  if (g.status !== 'pending') fail(409, 'You already guessed this name');
  const correct = b.optionIndex === g.answer;
  g.status = correct ? 'correct' : 'wrong';
  if (correct) {
    g.coinsAwarded = NAME_GUESS.coinsPerCorrect;
    state.coins += g.coinsAwarded;
    ledger('coins', 'name_guess', g.coinsAwarded);
  }
  return { guess: guessView(g), profile: publicView(p, false), coins: state.coins };
});

function emitMatch(p) {
  emitToClient('match:new', { user: publicView(p, false), message: `It's a match with ${p.name}! 🎉` });
}

route('POST', '/discover/:id/like', (b, { id }) => {
  requireComplete();
  const p = person(id);
  if (state.likesOut.includes(p.id)) fail(409, 'You already liked this person');
  const text = (b.message ?? '').trim();
  if (text && state.guesses[p.id]?.status !== 'correct') fail(403, 'Guess their name right to send a message');
  state.likesOut.push(p.id);
  if (text) state.messages.push({ id: nextId(), senderId: ME, receiverId: p.id, body: text.slice(0, NAME_GUESS.messageMaxLength), readAt: null, createdAt: now() });
  if (likedMe(p.id)) return { matched: true, profile: publicView(p, false) };
  // Demo people like you back after a moment (most of the time), so you can see a match happen.
  if (p.id % 3 !== 0) {
    setTimeout(() => {
      state.likesIn.push({ from: p.id, message: null, at: now(), declined: false });
      save();
      emitMatch(p);
    }, 3000);
  }
  return { matched: false, profile: publicView(p, false) };
});

route('GET', '/likes', () => ({
  likes: state.likesIn
    .filter((l) => !l.declined && !state.likesOut.includes(l.from) && !state.blocked.includes(l.from))
    .map((l) => ({ user: publicView(person(l.from), false), message: l.message, likedAt: l.at })),
}));
route('POST', '/likes/:id/accept', (_b, { id }) => {
  const p = person(id);
  const like = state.likesIn.find((l) => l.from === p.id) ?? fail(404, 'Like not found');
  if (!state.likesOut.includes(p.id)) state.likesOut.push(p.id);
  if (like.message && !state.messages.some((m) => m.senderId === p.id && m.body === like.message)) {
    state.messages.push({ id: nextId(), senderId: p.id, receiverId: ME, body: like.message, readAt: now(), createdAt: like.at });
  }
  return { matched: true };
});
route('POST', '/likes/:id/decline', (_b, { id }) => {
  const like = state.likesIn.find((l) => l.from === Number(id));
  if (like) like.declined = true;
  return { ok: true };
});
route('GET', '/admirers', () => ({ admirers: [] }));

const thread = (id) => state.messages.filter((m) => m.senderId === id || m.receiverId === id);
route('GET', '/conversations', () => ({
  conversations: state.people
    .filter((p) => matched(p.id) && !state.blocked.includes(p.id))
    .map((p) => {
      const t = thread(p.id);
      const last = t[t.length - 1];
      return { user: publicView(p, false), online: p.online, lastMessage: last?.body ?? null, lastAt: last?.createdAt ?? null, unread: t.filter((m) => m.senderId === p.id && !m.readAt).length };
    })
    .sort((x, y) => (y.lastAt ?? '').localeCompare(x.lastAt ?? '')),
}));
route('GET', '/messages/:id', (_b, { id }) => {
  const p = person(id);
  return {
    user: publicView(p), canMessage: matched(p.id) && !state.blocked.includes(p.id),
    waitingForLikeBack: state.likesOut.includes(p.id) && !likedMe(p.id), online: p.online, messages: thread(p.id).map(messageView),
  };
});
route('POST', '/messages/:id', (b, { id }) => {
  const p = person(id);
  if (!matched(p.id)) fail(403, 'You can chat once you both like each other');
  const msg = { id: nextId(), senderId: ME, receiverId: p.id, body: b.body.trim(), readAt: null, createdAt: now() };
  state.messages.push(msg);
  // The other person "types" a reply.
  setTimeout(() => {
    msg.readAt = now();
    const reply = { id: nextId(), senderId: p.id, receiverId: ME, body: REPLIES[thread(p.id).length % REPLIES.length], readAt: null, createdAt: now() };
    state.messages.push(reply);
    save();
    emitToClient('message:new', { message: reply, from: publicView(p, false) });
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

export function demoPhotoUrl(user) {
  if (user.id === ME) return state.mePhoto ?? '';
  const p = state.people.find((x) => x.id === user.id);
  return p ? demoPhoto(p) : '';
}

export { publicView as demoPublicView, rateFor, person as demoPerson, nextId as demoNextId, now as demoNow };
