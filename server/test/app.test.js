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
const { generateQuestions, puzzleState } = await import('../src/puzzle.js');
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
  form.append('blur', fakeJpeg(), 'blur.jpg');
  for (let i = 0; i < 9; i++) form.append(`tile${i}`, fakeJpeg(), `t${i}.jpg`);
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

test('puzzle state never exposes answers', () => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(asha.id);
  const qs = generateQuestions(user);
  assert.equal(qs.length, 4);
  for (const q of qs) assert.ok(q.options.length >= 2 && q.answer >= 0);
  const state = puzzleState({ id: 1, target_id: 1, questions: JSON.stringify(qs), status: 'in_progress', current_index: 0, correct: 0, wrong: 0, revealed: '[]' });
  assert.equal(JSON.stringify(state).includes('"answer"'), false);
});

test('discover shows complete profiles without puzzle answers', async () => {
  const r = await api(ravi.token, 'GET', '/api/discover');
  assert.equal(r.status, 200);
  const a = r.body.profiles.find((p) => p.id === asha.id);
  assert.ok(a);
  assert.equal(a.hobbies, undefined);
});

test('photo stays locked until the puzzle is solved; messaging unlocks after', async () => {
  assert.equal((await api(ravi.token, 'GET', `/api/photos/${asha.id}/full`)).status, 403);
  assert.equal((await api(ravi.token, 'GET', `/api/photos/${asha.id}/tile/0`)).status, 403);
  assert.equal((await api(ravi.token, 'GET', `/api/photos/${asha.id}/blur`)).status, 200);
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: 'hi' })).status, 403);

  let { body } = await api(ravi.token, 'POST', `/api/discover/${asha.id}/puzzle`);
  let p = body.puzzle;
  const answers = JSON.parse(db.prepare('SELECT questions FROM puzzle_attempts WHERE id = ?').get(p.attemptId).questions).map((q) => q.answer);

  // One wrong answer is allowed.
  const wrongOpt = answers[0] === 0 ? 1 : 0;
  ({ body } = await api(ravi.token, 'POST', `/api/puzzles/${p.attemptId}/answer`, { questionIndex: 0, optionIndex: wrongOpt }));
  assert.equal(body.puzzle.lastResult.correct, false);
  assert.equal(body.puzzle.revealed.length, 0);

  ({ body } = await api(ravi.token, 'POST', `/api/puzzles/${p.attemptId}/answer`, { questionIndex: 1, optionIndex: answers[1] }));
  assert.equal(body.puzzle.revealed.length, 3);
  const tile = body.puzzle.revealed[0];
  assert.equal((await api(ravi.token, 'GET', `/api/photos/${asha.id}/tile/${tile}`)).status, 200);

  // Replaying an answered question is rejected.
  assert.equal((await api(ravi.token, 'POST', `/api/puzzles/${p.attemptId}/answer`, { questionIndex: 1, optionIndex: answers[1] })).status, 409);

  ({ body } = await api(ravi.token, 'POST', `/api/puzzles/${p.attemptId}/answer`, { questionIndex: 2, optionIndex: answers[2] }));
  ({ body } = await api(ravi.token, 'POST', `/api/puzzles/${p.attemptId}/answer`, { questionIndex: 3, optionIndex: answers[3] }));
  assert.equal(body.puzzle.status, 'solved');
  assert.equal(body.puzzle.revealed.length, 9);
  assert.deepEqual(body.profile.hobbies, ['Cooking', 'Dancing', 'Reading']);

  assert.equal((await api(ravi.token, 'GET', `/api/photos/${asha.id}/full`)).status, 200);
  assert.equal((await api(ravi.token, 'POST', `/api/messages/${asha.id}`, { body: 'Hey Asha!' })).status, 201);
  assert.equal((await api(asha.token, 'POST', `/api/messages/${ravi.id}`, { body: 'Hi Ravi :)' })).status, 201);
  const convo = await api(asha.token, 'GET', '/api/conversations');
  assert.equal(convo.body.conversations[0].unread, 1);
  // Asha has not solved Ravi's puzzle, so his photo stays locked for her.
  assert.equal(convo.body.conversations[0].canSeePhoto, false);
  // Unrelated user still can't message.
  assert.equal((await api(kiran.token, 'POST', `/api/messages/${asha.id}`, { body: 'hi' })).status, 403);
});

test('failing a puzzle triggers a cooldown', async () => {
  const { body } = await api(kiran.token, 'POST', `/api/discover/${meera.id}/puzzle`);
  const answers = JSON.parse(db.prepare('SELECT questions FROM puzzle_attempts WHERE id = ?').get(body.puzzle.attemptId).questions).map((q) => q.answer);
  for (const i of [0, 1]) {
    const r = await api(kiran.token, 'POST', `/api/puzzles/${body.puzzle.attemptId}/answer`, { questionIndex: i, optionIndex: answers[i] === 0 ? 1 : 0 });
    if (i === 1) assert.equal(r.body.puzzle.status, 'failed');
  }
  const retry = await api(kiran.token, 'POST', `/api/discover/${meera.id}/puzzle`);
  assert.equal(retry.status, 429);
  assert.ok(retry.body.puzzle.retryAt);
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

test('free calls need a puzzle connection', async () => {
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
