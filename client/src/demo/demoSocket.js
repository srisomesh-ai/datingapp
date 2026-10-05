// Fake Socket.IO client for the static demo. Calls connect to a local "peer" that
// sends an animated video, so the real WebRTC call screen can be tested end to end.
import { PLATFORM_FEE_PERCENT } from '../../../server/src/config.js';
import { affordable, demoNextId, demoNow, demoPerson, demoPublicView, demoState, ledger, rateFor, save } from './demoApi.js';

// One billed minute lasts this long in the demo so the meter visibly moves.
export const DEMO_MINUTE_MS = 10_000;

const listeners = new Map();
export function emitToClient(event, payload) {
  setTimeout(() => listeners.get(event)?.forEach((fn) => fn(payload)), 0);
}

let live = null; // the one active demo call

function fakeStream(name) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 480, height: 640 });
  const ctx = canvas.getContext('2d');
  let t = 0;
  const timer = setInterval(() => {
    t += 1;
    const g = ctx.createLinearGradient(0, 0, 480, 640);
    g.addColorStop(0, `hsl(${(t * 2) % 360},60%,45%)`);
    g.addColorStop(1, `hsl(${(t * 2 + 80) % 360},60%,25%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 480, 640);
    ctx.fillStyle = '#faebdc';
    ctx.beginPath();
    ctx.arc(240, 250, 110 + Math.sin(t / 4) * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(240, 640, 200, 190, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b5a6e';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${name} · demo video`, 240, 560);
  }, 1000 / 24);
  const stream = canvas.captureStream(24);
  try {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0; // silent audio track
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
    stream.stopAudio = () => ac.close();
  } catch {
    /* audio not available */
  }
  stream.stopDrawing = () => clearInterval(timer);
  return stream;
}

function makeRemotePeer(callId, name) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const stream = fakeStream(name);
  stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
  pc.onicecandidate = (e) => e.candidate && emitToClient('rtc:signal', { callId, data: { type: 'candidate', candidate: e.candidate.toJSON() } });
  pc.cleanup = () => {
    stream.getTracks().forEach((tr) => tr.stop());
    stream.stopDrawing();
    stream.stopAudio?.();
    pc.close();
  };
  return pc;
}

function startBilling() {
  if (live.mode !== 'paid') return;
  const tick = () => {
    const s = demoState();
    const gross = live.rate.paisePerMinute;
    const fee = Math.round((gross * PLATFORM_FEE_PERCENT) / 100);
    if (live.role === 'callee') {
      s.earningsPaise += gross - fee;
      live.earned += gross - fee;
      ledger('earnings', 'call_earning', gross - fee);
    } else {
      const lot = s.lots.find((l) => l.rateKey === live.rate.rateKey && l.minutesLeft > 0);
      if (lot) {
        lot.minutesLeft -= 1;
        live.paid += lot.paisePerMinute;
        ledger('package', 'call_minute', -1, '1 package minute');
      } else if (s.walletPaise >= gross) {
        s.walletPaise -= gross;
        live.paid += gross;
        ledger('wallet', 'call_charge', -gross);
      } else {
        return endCall('insufficient_balance');
      }
    }
    live.minutes += 1;
    save();
    const minutesLeft = live.role === 'caller' ? affordable(live.rate) : undefined;
    emitToClient('call:billing', { callId: live.id, billedMinutes: live.minutes, paidPaise: live.paid, earnedPaise: live.earned, minutesLeft });
    if (live.role === 'caller' && minutesLeft < 2) emitToClient('call:low-balance', { callId: live.id, minutesLeft });
  };
  tick();
  live.billTimer = setInterval(tick, DEMO_MINUTE_MS);
}

function endCall(reason, status) {
  if (!live) return;
  const c = live;
  live = null;
  clearTimeout(c.timer);
  clearInterval(c.billTimer);
  c.peer?.cleanup();
  const finalStatus = status ?? (c.active ? 'ended' : 'missed');
  const s = demoState();
  s.calls.unshift({
    id: c.id, direction: c.role === 'caller' ? 'outgoing' : 'incoming', other: demoPublicView(c.other), media: c.media, mode: c.mode,
    status: finalStatus, minutes: c.minutes, amountPaise: c.role === 'caller' ? -c.paid : c.earned, endReason: reason, createdAt: demoNow(),
  });
  save();
  emitToClient('call:ended', { callId: c.id, status: finalStatus, mode: c.mode, billedMinutes: c.minutes, callerPaidPaise: c.paid, hostEarnedPaise: c.earned, endReason: reason, reason });
}

async function handle(event, payload = {}, ack = () => {}) {
  if (event === 'call:start') {
    const other = demoPerson(payload.to);
    if (live) return ack({ error: 'You are already in a call' });
    if (!other.online) return ack({ error: `${other.name} is offline` });
    let rate = null;
    if (payload.mode === 'paid') {
      if (!other.is_host || !other.host_available) return ack({ error: `${other.name} is not taking calls right now` });
      rate = rateFor(other.gender);
      if (affordable(rate) < 1) return ack({ error: 'Not enough balance. Add money or buy a package.', code: 'insufficient_balance' });
    }
    live = { id: demoNextId(), role: 'caller', other, media: payload.media, mode: payload.mode, rate, minutes: 0, paid: 0, earned: 0, active: false };
    ack({ ok: true, callId: live.id, iceServers: [], callee: demoPublicView(other), canSeePhoto: true, rate });
    live.timer = setTimeout(() => {
      live.active = true;
      emitToClient('call:accepted', { callId: live.id });
      startBilling();
    }, 2500);
    return undefined;
  }
  if (!live || Number(payload.callId) !== live.id) return ack({ error: 'Call is no longer available' });

  if (event === 'call:accept') {
    live.active = true;
    clearTimeout(live.timer);
    ack({ ok: true, iceServers: [] });
    // The demo caller sends the offer.
    live.peer = makeRemotePeer(live.id, live.other.name);
    const offer = await live.peer.createOffer();
    await live.peer.setLocalDescription(offer);
    emitToClient('rtc:signal', { callId: live.id, data: { type: 'offer', sdp: offer } });
    startBilling();
  } else if (event === 'call:reject') {
    endCall('rejected', 'rejected');
  } else if (event === 'call:end') {
    endCall('hangup');
  } else if (event === 'rtc:signal') {
    const { data } = payload;
    if (data.type === 'offer') {
      live.peer = makeRemotePeer(live.id, live.other.name);
      await live.peer.setRemoteDescription(data.sdp);
      const answer = await live.peer.createAnswer();
      await live.peer.setLocalDescription(answer);
      emitToClient('rtc:signal', { callId: live.id, data: { type: 'answer', sdp: answer } });
    } else if (data.type === 'answer') {
      await live.peer?.setRemoteDescription(data.sdp);
    } else if (data.type === 'candidate') {
      await live.peer?.addIceCandidate(data.candidate).catch(() => {});
    }
  }
  return undefined;
}

/** Ring the demo user with a call from a random demo person (paid if they're in Friend mode). */
export function simulateIncomingCall() {
  if (live) return;
  const s = demoState();
  const other = s.people[Math.floor(Math.random() * s.people.length)];
  const paid = Boolean(s.me?.isHost);
  const rate = paid ? rateFor(s.me.gender) : null;
  live = { id: demoNextId(), role: 'callee', other, media: 'video', mode: paid ? 'paid' : 'free', rate, minutes: 0, paid: 0, earned: 0, active: false };
  live.timer = setTimeout(() => endCall('no_answer', 'missed'), 30_000);
  emitToClient('call:incoming', { callId: live.id, from: demoPublicView(other), canSeePhoto: true, media: 'video', mode: live.mode, rate });
}

export function createDemoSocket() {
  const mine = []; // [event, fn] registered through this socket, dropped on disconnect
  return {
    connected: true,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      mine.push([event, fn]);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit(event, payload, ack) {
      handle(event, payload, ack).catch((err) => console.error('demo socket', err));
    },
    disconnect() {
      for (const [event, fn] of mine) listeners.get(event)?.delete(fn);
      endCall('disconnected');
    },
  };
}
