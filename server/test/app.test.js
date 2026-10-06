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

test('name mask keeps the first letter and hides most of the rest', () => {
  const m = maskName('Ananya');
  assert.equal(m[0], 'A');
  assert.ok(m.split(' ').filter((c) => c === '_').length >= 3);
  const g = buildNameGuess({ name: 'Ananya Rao', gender: 'female' });
  assert.equal(g.options.length, 4);
  assert.equal(g.options[g.answer], 'Ananya');
  assert.equal(new Set(g.options).size, 4);
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

test('correct guess: +1 coin, one message with the like, match on like back', async () => {
  const ans = answerOf(ravi, asha);
  let r = await api(ravi.token, 'POST', `/api/discover/${asha.id}/guess`, { optionIndex: ans });
  assert.equal(r.status, 200);
  assert.equal(r.body.guess.status, 'correct');
  assert.equal(r.body.guess.coinsAwarded, 1);
  assert.equal(r.body.coins, 1);
  assert.equal(r.body.profile.name, 'Asha');
  // Only one guess.
  assert.equal((await api(ravi.token, 'POST', `/api/discover/${asha.id}/guess`, { optionIndex: ans })).status, 409);

  // No chat before a match.
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: 'hi' })).status, 403);
  r = await api(ravi.token, 'POST', `/api/discover/${asha.id}/like`, { message: 'Hey Asha! Got your name first try 😄' });
  assert.equal(r.status, 200);
  assert.equal(r.body.matched, false);
  assert.equal((await api(ravi.token, 'POST', `/api/discover/${asha.id}/like`, {})).status, 409);
  // Still just the one message until she likes back.
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: 'hello?' })).status, 403);
  const waiting = await api(ravi.token, 'GET', `/api/messages/${asha.id}`);
  assert.equal(waiting.body.waitingForLikeBack, true);
  assert.equal(waiting.body.canMessage, false);

  // Asha sees the like with the message and who sent it.
  const likes = await api(asha.token, 'GET', '/api/likes');
  const l = likes.body.likes.find((x) => x.user.id === ravi.id);
  assert.equal(l.message, 'Hey Asha! Got your name first try 😄');
  assert.equal(l.user.name, 'Ravi');

  assert.equal((await api(asha.token, 'POST', `/api/likes/${ravi.id}/accept`)).body.matched, true);
  assert.equal((await api(asha.token, 'GET', '/api/likes')).body.likes.length, 0);
  assert.equal((await api(asha.token, 'POST', `/api/messages/${ravi.id}`, { body: 'Hi Ravi :)' })).status, 201);
  const convo = await api(ravi.token, 'GET', '/api/conversations');
  assert.equal(convo.body.conversations[0].user.id, asha.id);
  assert.equal(convo.body.conversations[0].unread, 1);
  const thread = await api(ravi.token, 'GET', `/api/messages/${asha.id}`);
  assert.deepEqual(thread.body.messages.map((m) => m.body), ['Hey Asha! Got your name first try 😄', 'Hi Ravi :)']);
  // Matched people drop out of Discover.
  assert.equal((await api(ravi.token, 'GET', '/api/discover')).body.profiles.some((p) => p.id === asha.id), false);
  // Unrelated user still can't message.
  assert.equal((await api(kiran.token, 'POST', `/api/messages/${asha.id}`, { body: 'hi' })).status, 403);
});

test('wrong guess: no coin and no message, but a plain like still works', async () => {
  await api(kiran.token, 'GET', '/api/discover');
  const ans = answerOf(kiran, meera);
  const r = await api(kiran.token, 'POST', `/api/discover/${meera.id}/guess`, { optionIndex: ans === 0 ? 1 : 0 });
  assert.equal(r.body.guess.status, 'wrong');
  assert.equal(r.body.guess.correctOption, ans);
  assert.equal(r.body.coins, 0);
  assert.equal((await api(kiran.token, 'POST', `/api/discover/${meera.id}/like`, { message: 'hi' })).status, 403);
  assert.equal((await api(kiran.token, 'POST', `/api/discover/${meera.id}/like`, {})).status, 200);
  const likes = await api(meera.token, 'GET', '/api/likes');
  assert.equal(likes.body.likes[0].message, null);
  assert.equal((await api(meera.token, 'POST', `/api/likes/${kiran.id}/decline`)).status, 200);
  assert.equal((await api(meera.token, 'GET', '/api/likes')).body.likes.length, 0);
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
    const fee = db.prepare("SELECT SUM(amount_paise) AS s FROM transactions WHERE account = 'platform'").get().s;
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

test('free calls need a match', async () => {
  const rSock = await connect(ravi.token);
  const aSock = await connect(asha.token);
  const kSock = await connect(kiran.token);
  try {
    const denied = await emitAck(kSock, 'call:start', { to: asha.id, media: 'audio', mode: 'free' });
    assert.ok(denied.error);
    const incoming = once(aSock, 'call:incoming');
    const ok = await emitAck(rSock, 'call:start', { to: asha.id, media: 'audio', mode: 'free' });
    assert.ok(ok.ok);
    await incoming;
    const ended = once(rSock, 'call:ended');
    aSock.emit('call:reject', { callId: ok.callId });
    assert.equal((await ended).status, 'rejected');
  } finally {
    rSock.close();
    aSock.close();
    kSock.close();
  }
});

test('friends withdraw earnings', async () => {
  assert.equal((await api(meera.token, 'POST', '/api/wallet/withdraw', { amountRupees: 100, upiId: 'meera@okbank' })).status, 402);
  db.prepare('UPDATE users SET earnings_paise = 20000 WHERE id = ?').run(meera.id);
  const r = await api(meera.token, 'POST', '/api/wallet/withdraw', { amountRupees: 150, upiId: 'meera@okbank' });
  assert.equal(r.status, 201);
  assert.equal(r.body.earningsPaise, 5000);
});
