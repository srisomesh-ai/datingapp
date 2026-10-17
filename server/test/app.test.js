import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'datingapp-test-'));
process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = tmp;
process.env.BILLING_INTERVAL_MS = '150';
process.env.RING_TIMEOUT_MS = '2000';
process.env.SAMPLE_CALL_SECONDS = '1';
process.env.TURN_URLS = 'turn:turn.example.test:3478?transport=udp,turn:turn.example.test:3478?transport=tcp';
process.env.TURN_SECRET = 'test-turn-secret';

const { createServer } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { splitFee } = await import('../src/billing.js');
const { buildNameGuess, maskName } = await import('../src/nameGuess.js');
const { io: ioClient } = await import('socket.io-client');

let server;
let base;
before(async () => {
  ({ server } = createServer());
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function api(token, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, body: json };
}

const fakeJpeg = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: 'image/jpeg' });

async function makeUser(name, gender, extra = {}) {
  const reg = await api(null, 'POST', '/api/auth/register', {
    email: `${name.toLowerCase()}@example.com`,
    password: 'password123',
    name,
    gender,
    dob: '1998-05-10',
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const token = reg.body.token;
  const prof = await api(token, 'PUT', '/api/profile', {
    interestedIn: 'everyone',
    lookingFor: 'both',
    hobbies: ['Cooking', 'Dancing', 'Reading'],
    likes: ['Coffee', 'Pets', 'Anime'],
    favoriteCuisine: 'Italian',
    weekendStyle: 'Family time',
    chronotype: 'Night owl',
    dreamDestination: 'Beaches',
    ...extra,
  });
  assert.equal(prof.status, 200, JSON.stringify(prof.body));
  const form = new FormData();
  form.append('full', fakeJpeg(), 'full.jpg');
  const up = await api(token, 'POST', '/api/profile/photo', form);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.user.profileComplete, true);
  return { token, id: reg.body.user.id };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(base, { auth: { token }, transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const once = (socket, event) => new Promise((r) => socket.once(event, r));
const emitAck = (socket, event, payload) => new Promise((r) => socket.emit(event, payload, r));

let asha, ravi, meera, kiran;

test('registration rejects under-18 users', async () => {
  const r = await api(null, 'POST', '/api/auth/register', {
    email: 'kid@example.com', password: 'password123', name: 'Kid', gender: 'male', dob: new Date().toISOString().slice(0, 10),
  });
  assert.equal(r.status, 400);
});

test('set up users', async () => {
  asha = await makeUser('Asha', 'female');
  ravi = await makeUser('Ravi', 'male');
  meera = await makeUser('Meera', 'female');
  kiran = await makeUser('Kiran', 'male');
});

test('fee split is 25% platform / 75% friend', () => {
  assert.deepEqual(splitFee(1000), { fee: 250, hostShare: 750 });
  assert.deepEqual(splitFee(2000), { fee: 500, hostShare: 1500 });
});

test('guessing is easy: half the letters show and only the answer fits the first letter', () => {
  const m = maskName('Ananya');
  assert.equal(m[0], 'A');
  assert.equal(m.split(' ').filter((c) => c !== '_').length, 3); // A + 2 of the other 5
  for (let i = 0; i < 20; i++) {
    const g = buildNameGuess({ name: 'Ananya Rao', gender: 'female' });
    assert.equal(g.options.length, 4);
    assert.equal(g.options[g.answer], 'Ananya');
    assert.equal(new Set(g.options).size, 4);
    assert.deepEqual(g.options.filter((o) => o[0] === 'A'), ['Ananya']);
  }
});

const answerOf = (visitor, target) =>
  db.prepare('SELECT answer FROM name_guesses WHERE visitor_id = ? AND target_id = ?').get(visitor.id, target.id).answer;

test('discover shows the photo and profile but hides the name', async () => {
  const r = await api(ravi.token, 'GET', '/api/discover');
  assert.equal(r.status, 200);
  const a = r.body.profiles.find((p) => p.id === asha.id);
  assert.ok(a);
  assert.equal(a.name, null);
  assert.match(a.nameMask, /^A( [_a-z])+$/);
  assert.equal(a.guess.options.length, 4);
  assert.equal(a.guess.correctOption, undefined);
  assert.deepEqual(a.hobbies, ['Cooking', 'Dancing', 'Reading']);
  // The real name appears only as one of the options.
  assert.ok(a.guess.options.includes('Asha'));
  assert.equal(JSON.stringify({ ...a, guess: null }).includes('Asha'), false);
  // Photo is visible right away.
  assert.equal((await api(ravi.token, 'GET', `/api/photos/${asha.id}/full`)).status, 200);
  // /users/:id doesn't leak the name either.
  assert.equal((await api(ravi.token, 'GET', `/api/users/${asha.id}`)).body.user.name, null);
});

test('right guess: +1 coin, both get a chat, the other person is notified', async () => {
  const aSock = await connect(asha.token);
  try {
    const notified = once(aSock, 'guess:correct');
    const ans = answerOf(ravi, asha);
    let r = await api(ravi.token, 'POST', `/api/discover/${asha.id}/guess`, { optionIndex: ans });
    assert.equal(r.status, 200);
    assert.equal(r.body.guess.status, 'correct');
    assert.equal(r.body.guess.connected, true);
    assert.equal(r.body.guess.coinsAwarded, 1);
    assert.equal(r.body.coins, 1);
    assert.equal(r.body.profile.name, 'Asha');
    assert.match((await notified).message, /Ravi guessed your name/);
    assert.equal((await api(ravi.token, 'POST', `/api/discover/${asha.id}/guess`, { optionIndex: ans })).status, 409);
  } finally {
    aSock.close();
  }
  // Chat is open for both right away.
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: 'Hey Asha!' })).status, 201);
  assert.equal((await api(asha.token, 'POST', `/api/messages/${ravi.id}`, { body: 'Hi Ravi :)' })).status, 201);
  const convo = await api(asha.token, 'GET', '/api/conversations');
  assert.equal(convo.body.conversations[0].user.name, 'Ravi');
  assert.equal(convo.body.conversations[0].guessedYou, true);
  assert.equal(convo.body.conversations[0].unread, 1);
  // Connected people drop out of Discover; strangers still can't message.
  assert.equal((await api(ravi.token, 'GET', '/api/discover')).body.profiles.some((p) => p.id === asha.id), false);
  assert.equal((await api(kiran.token, 'POST', `/api/messages/${asha.id}`, { body: 'hi' })).status, 403);
});

test('chat is free for 10 messages each, then ₹49 unlocks it', async () => {
  for (let i = 2; i <= 10; i++) {
    const r = await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: `msg ${i}` });
    assert.equal(r.status, 201);
    if (i === 10) assert.equal(r.body.chat.freeLeft, 0);
  }
  let r = await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: 'one more' });
  assert.equal(r.status, 402);
  assert.equal(r.body.code, 'chat_limit');
  // Asha still has her own free messages.
  assert.equal((await api(asha.token, 'GET', `/api/messages/${ravi.id}`)).body.chat.freeLeft, 9);
  // Unlock needs wallet money.
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}/unlock`)).status, 402);
  db.prepare('UPDATE users SET wallet_paise = 100_00 WHERE id = ?').run(ravi.id);
  r = await api(ravi.token, 'POST', `/api/messages/${asha.id}/unlock`);
  assert.equal(r.status, 200);
  assert.equal(r.body.chat.unlocked, true);
  assert.equal(r.body.walletPaise, 51_00);
  // Unlocking twice doesn't charge twice.
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}/unlock`)).body.walletPaise, 51_00);
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: 'unlimited now' })).status, 201);
  const fee = db.prepare("SELECT SUM(amount_paise) AS s FROM transactions WHERE account = 'platform' AND type = 'chat_unlock'").get().s;
  assert.equal(fee, 49_00);
  db.prepare('UPDATE users SET wallet_paise = 0 WHERE id = ?').run(ravi.id);
});

test('wrong guess: no chat, answer stays hidden, retry after 24 hours', async () => {
  await api(kiran.token, 'GET', '/api/discover');
  const ans = answerOf(kiran, meera);
  let r = await api(kiran.token, 'POST', `/api/discover/${meera.id}/guess`, { optionIndex: ans === 0 ? 1 : 0 });
  assert.equal(r.body.guess.status, 'wrong');
  assert.equal(r.body.guess.correctOption, undefined);
  assert.ok(r.body.guess.retryAt);
  assert.equal(r.body.profile.name, null);
  assert.equal(r.body.coins, 0);
  assert.equal((await api(kiran.token, 'POST', `/api/messages/${meera.id}`, { body: 'hi' })).status, 403);
  assert.equal((await api(kiran.token, 'POST', `/api/discover/${meera.id}/guess`, { optionIndex: ans })).status, 429);
  assert.equal((await api(kiran.token, 'GET', '/api/discover')).body.profiles.some((p) => p.id === meera.id), false);
  // A day later she's back with a fresh round.
  db.prepare("UPDATE name_guesses SET guessed_at = datetime('now', '-25 hours') WHERE visitor_id = ? AND target_id = ?").run(kiran.id, meera.id);
  r = await api(kiran.token, 'GET', '/api/discover');
  const card = r.body.profiles.find((p) => p.id === meera.id);
  assert.equal(card.guess.status, 'pending');
});

test('wallet top-up (mock), packages and validation', async () => {
  assert.equal((await api(kiran.token, 'POST', '/api/wallet/topup/order', { amountRupees: 10 })).status, 400);
  const order = await api(kiran.token, 'POST', '/api/wallet/topup/order', { amountRupees: 500 });
  assert.equal(order.body.provider, 'mock');
  let r = await api(kiran.token, 'POST', '/api/wallet/topup/verify', { orderId: order.body.orderId });
  assert.equal(r.body.walletPaise, 500_00);
  // Idempotent.
  r = await api(kiran.token, 'POST', '/api/wallet/topup/verify', { orderId: order.body.orderId });
  assert.equal(r.body.walletPaise, 500_00);

  r = await api(kiran.token, 'POST', '/api/packages/female-15/buy');
  assert.equal(r.body.walletPaise, 230_00);
  assert.equal(r.body.packageMinutes.female, 15);
  assert.equal((await api(kiran.token, 'POST', '/api/packages/female-60/buy')).status, 402);
});

test('only listed friends with complete profiles can go available', async () => {
  const r = await api(meera.token, 'PUT', '/api/friends/me', { isHost: true, hostAvailable: true, hostHeadline: 'Let\'s talk movies' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.hostAvailable, true);
});

test('paid call: package minutes first, then wallet; 25% fee; ends when balance runs out', async () => {
  // Shrink Kiran's balances: 1 package minute + ₹30 in wallet = 1 + 1 minute with a female friend (₹20/min).
  db.prepare('UPDATE credit_lots SET minutes_left = 1 WHERE user_id = ?').run(kiran.id);
  db.prepare('UPDATE users SET wallet_paise = 3000 WHERE id = ?').run(kiran.id);

  const kSock = await connect(kiran.token);
  const mSock = await connect(meera.token);
  try {
    const list = await api(kiran.token, 'GET', '/api/friends?gender=female');
    const m = list.body.friends.find((f) => f.id === meera.id);
    assert.equal(m.status, 'available');
    assert.equal(m.rate.paisePerMinute, 2000);
    assert.equal(m.affordableMinutes, 2);

    const incoming = once(mSock, 'call:incoming');
    const start = await emitAck(kSock, 'call:start', { to: meera.id, media: 'video', mode: 'paid' });
    assert.ok(start.ok, JSON.stringify(start));
    const inc = await incoming;
    assert.equal(inc.callId, start.callId);

    const accepted = once(kSock, 'call:accepted');
    const ended = once(kSock, 'call:ended');
    const signal = once(mSock, 'rtc:signal');
    assert.ok((await emitAck(mSock, 'call:accept', { callId: start.callId })).ok);
    await accepted;
    kSock.emit('rtc:signal', { callId: start.callId, data: { type: 'offer', sdp: 'x' } });
    assert.equal((await signal).data.type, 'offer');

    const end = await ended;
    assert.equal(end.reason, 'insufficient_balance');
    assert.equal(end.billedMinutes, 2);
    // Minute 1 from package (₹18 effective), minute 2 from wallet (₹20).
    assert.equal(end.callerPaidPaise, 1800 + 2000);
    assert.equal(end.hostEarnedPaise, 1350 + 1500);

    const meeraRow = db.prepare('SELECT earnings_paise FROM users WHERE id = ?').get(meera.id);
    assert.equal(meeraRow.earnings_paise, 2850);
    const fee = db.prepare("SELECT SUM(amount_paise) AS s FROM transactions WHERE account = 'platform' AND type = 'platform_fee'").get().s;
    assert.equal(fee, 450 + 500);
    assert.equal(db.prepare('SELECT wallet_paise FROM users WHERE id = ?').get(kiran.id).wallet_paise, 1000);

    // Not enough for another minute now.
    const again = await emitAck(kSock, 'call:start', { to: meera.id, media: 'audio', mode: 'paid' });
    assert.equal(again.code, 'insufficient_balance');
  } finally {
    kSock.close();
    mSock.close();
  }
});

test('no free calls: connected people pay ₹5/min, and the platform keeps it', async () => {
  const rSock = await connect(ravi.token);
  const aSock = await connect(asha.token);
  const kSock = await connect(kiran.token);
  try {
    assert.ok((await emitAck(rSock, 'call:start', { to: asha.id, media: 'audio', mode: 'free' })).error);
    // Not connected: no match call.
    assert.match((await emitAck(kSock, 'call:start', { to: asha.id, media: 'audio', mode: 'match' })).error, /Guess their name/);
    // Connected but no money.
    assert.equal((await emitAck(rSock, 'call:start', { to: asha.id, media: 'audio', mode: 'match' })).code, 'insufficient_balance');

    db.prepare('UPDATE users SET wallet_paise = 10_00 WHERE id = ?').run(ravi.id); // 2 minutes
    const feeBefore = db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM transactions WHERE account = 'platform'").get().s;
    const earningsBefore = db.prepare('SELECT earnings_paise FROM users WHERE id = ?').get(asha.id).earnings_paise;
    const incoming = once(aSock, 'call:incoming');
    const start = await emitAck(rSock, 'call:start', { to: asha.id, media: 'audio', mode: 'match' });
    assert.ok(start.ok, JSON.stringify(start));
    assert.equal(start.kind, 'match');
    assert.equal(start.rate.paisePerMinute, 5_00);
    assert.equal((await incoming).kind, 'match');
    const ended = once(rSock, 'call:ended');
    assert.ok((await emitAck(aSock, 'call:accept', { callId: start.callId })).ok);
    const end = await ended;
    assert.equal(end.reason, 'insufficient_balance');
    assert.equal(end.billedMinutes, 2);
    assert.equal(end.callerPaidPaise, 10_00);
    assert.equal(end.hostEarnedPaise, 0);
    assert.equal(db.prepare('SELECT earnings_paise FROM users WHERE id = ?').get(asha.id).earnings_paise, earningsBefore);
    const feeAfter = db.prepare("SELECT SUM(amount_paise) AS s FROM transactions WHERE account = 'platform'").get().s;
    assert.equal(feeAfter - feeBefore, 10_00);
  } finally {
    rSock.close();
    aSock.close();
    kSock.close();
  }
});

test('sample call: 10 coins for 1 minute with anyone, charged only if they accept', async () => {
  db.prepare('UPDATE users SET coins = 15 WHERE id = ?').run(kiran.id);
  const kSock = await connect(kiran.token);
  const aSock = await connect(asha.token);
  const rSock = await connect(ravi.token);
  const coinsOf = (u) => db.prepare('SELECT coins FROM users WHERE id = ?').get(u.id).coins;
  try {
    // Declined: no coins taken. The incoming call says it's a 1-minute sample.
    let incoming = once(aSock, 'call:incoming');
    let start = await emitAck(kSock, 'call:start', { to: asha.id, media: 'video', mode: 'sample' });
    assert.ok(start.ok, JSON.stringify(start));
    assert.equal(start.limitSeconds, 1);
    assert.equal(start.callee.name, null); // Kiran never guessed Asha's name
    assert.equal((await incoming).limitSeconds, 1);
    let ended = once(kSock, 'call:ended');
    aSock.emit('call:reject', { callId: start.callId });
    assert.equal((await ended).status, 'rejected');
    assert.equal(coinsOf(kiran), 15);

    // Accepted: 10 coins spent, call ends itself when the time is up.
    incoming = once(aSock, 'call:incoming');
    start = await emitAck(kSock, 'call:start', { to: asha.id, media: 'video', mode: 'sample' });
    await incoming;
    ended = once(kSock, 'call:ended');
    assert.ok((await emitAck(aSock, 'call:accept', { callId: start.callId })).ok);
    assert.equal(coinsOf(kiran), 5);
    const end = await ended;
    assert.equal(end.reason, 'time_up');
    assert.equal(end.coinsSpent, 10);
    const tx = db.prepare("SELECT * FROM transactions WHERE user_id = ? AND type = 'sample_call'").all(kiran.id);
    assert.deepEqual(tx.map((t) => t.amount_paise), [-10]);

    // Once per person per day, and coins are checked up front.
    db.prepare('UPDATE users SET coins = 20 WHERE id = ?').run(kiran.id);
    assert.match((await emitAck(kSock, 'call:start', { to: asha.id, media: 'audio', mode: 'sample' })).error, /already used a coin call/);
    db.prepare('UPDATE users SET coins = 5 WHERE id = ?').run(kiran.id);
    assert.equal((await emitAck(kSock, 'call:start', { to: ravi.id, media: 'audio', mode: 'sample' })).code, 'insufficient_coins');
  } finally {
    kSock.close();
    aSock.close();
    rSock.close();
  }
});

test('TURN credentials are per-user, short-lived and never in the public meta', async () => {
  const crypto = await import('node:crypto');
  assert.equal((await api(null, 'GET', '/api/ice')).status, 401);
  const meta = await api(null, 'GET', '/api/meta');
  assert.equal(JSON.stringify(meta.body).includes('turn:'), false);
  const { body } = await api(ravi.token, 'GET', '/api/ice');
  const turn = body.iceServers.find((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')));
  assert.ok(turn);
  const [expiry, uid] = turn.username.split(':').map(Number);
  assert.equal(uid, ravi.id);
  assert.ok(expiry > Date.now() / 1000 + 3600);
  // Same formula coturn uses with use-auth-secret.
  assert.equal(turn.credential, crypto.createHmac('sha1', 'test-turn-secret').update(turn.username).digest('base64'));
});

test('friends withdraw earnings', async () => {
  assert.equal((await api(meera.token, 'POST', '/api/wallet/withdraw', { amountRupees: 100, upiId: 'meera@okbank' })).status, 402);
  db.prepare('UPDATE users SET earnings_paise = 20000 WHERE id = ?').run(meera.id);
  const r = await api(meera.token, 'POST', '/api/wallet/withdraw', { amountRupees: 150, upiId: 'meera@okbank' });
  assert.equal(r.status, 201);
  assert.equal(r.body.earningsPaise, 5000);
});
