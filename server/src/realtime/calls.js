// Call lifecycle + WebRTC signaling relay + per-minute billing timers.
// Media flows peer-to-peer (WebRTC); the server only relays SDP/ICE and bills.
import { BILLING_INTERVAL_MS, ICE_SERVERS, LOW_BALANCE_MINUTES, RING_TIMEOUT_MS } from '../config.js';
import { one, run } from '../db.js';
import { affordableMinutes, chargeMinute } from '../billing.js';
import { isMatched } from '../connections.js';
import { emitToUser, isOnline } from './hub.js';
import { hostRate, isBlockedEitherWay, publicView } from '../util.js';

const calls = new Map(); // callId -> live call state
const userCall = new Map(); // userId -> callId

export const isBusy = (userId) => userCall.has(userId);

// Anything left "live" in the DB from a previous process can't be resumed.
run("UPDATE calls SET status = 'failed', end_reason = 'server_restart', ended_at = CURRENT_TIMESTAMP WHERE status IN ('ringing','active')");

function summary(callId) {
  const c = one('SELECT * FROM calls WHERE id = ?', callId);
  return {
    callId: c.id,
    status: c.status,
    mode: c.mode,
    billedMinutes: c.billed_minutes,
    callerPaidPaise: c.caller_paid_paise,
    hostEarnedPaise: c.host_earned_paise,
    startedAt: c.started_at,
    endedAt: c.ended_at,
    endReason: c.end_reason,
  };
}

export function endCall(callId, reason, { status } = {}) {
  const live = calls.get(callId);
  if (!live) return;
  clearTimeout(live.ringTimer);
  clearInterval(live.billTimer);
  calls.delete(callId);
  userCall.delete(live.callerId);
  userCall.delete(live.calleeId);

  const finalStatus = status ?? (live.status === 'active' ? 'ended' : 'missed');
  run('UPDATE calls SET status = ?, end_reason = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?', finalStatus, reason, callId);
  const s = summary(callId);
  emitToUser(live.callerId, 'call:ended', { ...s, reason });
  emitToUser(live.calleeId, 'call:ended', { ...s, reason });
}

function billNextMinute(live) {
  const result = chargeMinute(live.id);
  if (!result.ok) {
    endCall(live.id, result.reason === 'insufficient_balance' ? 'insufficient_balance' : 'billing_error');
    return false;
  }
  const c = result.call;
  emitToUser(live.callerId, 'call:billing', {
    callId: live.id,
    billedMinutes: c.billed_minutes,
    paidPaise: c.caller_paid_paise,
    minutesLeft: result.minutesLeft,
  });
  emitToUser(live.calleeId, 'call:billing', { callId: live.id, billedMinutes: c.billed_minutes, earnedPaise: c.host_earned_paise });
  if (result.minutesLeft < LOW_BALANCE_MINUTES) {
    emitToUser(live.callerId, 'call:low-balance', { callId: live.id, minutesLeft: result.minutesLeft });
  }
  return true;
}

export function registerCallHandlers(io, socket) {
  const me = socket.data.user;

  socket.on('call:start', ({ to, media, mode } = {}, ack = () => {}) => {
    try {
      const callee = one('SELECT * FROM users WHERE id = ? AND is_banned = 0', Number(to));
      if (!callee || callee.id === me.id) return ack({ error: 'User not found' });
      if (!['audio', 'video'].includes(media)) return ack({ error: 'Invalid call type' });
      if (!['paid', 'free'].includes(mode)) return ack({ error: 'Invalid call mode' });
      if (isBlockedEitherWay(me.id, callee.id)) return ack({ error: 'You cannot call this person' });
      if (isBusy(me.id)) return ack({ error: 'You are already in a call' });
      if (!isOnline(callee.id)) return ack({ error: `${callee.name} is offline` });
      if (isBusy(callee.id)) return ack({ error: `${callee.name} is on another call` });

      let rate = { rateKey: null, paisePerMinute: 0 };
      if (mode === 'paid') {
        if (!callee.is_host || !callee.host_available) return ack({ error: `${callee.name} is not taking calls right now` });
        rate = hostRate(callee.gender);
        if (affordableMinutes(me.id, rate.rateKey, rate.paisePerMinute) < 1) {
          return ack({ error: 'Not enough balance. Add money or buy a package.', code: 'insufficient_balance' });
        }
      } else if (!isMatched(me.id, callee.id)) {
        return ack({ error: 'You can call for free once you both like each other' });
      }

      const { lastInsertRowid } = run(
        'INSERT INTO calls (caller_id, callee_id, media, mode, rate_key, rate_paise_per_min) VALUES (?, ?, ?, ?, ?, ?)',
        me.id,
        callee.id,
        media,
        mode,
        rate.rateKey,
        rate.paisePerMinute,
      );
      const callId = Number(lastInsertRowid);
      const live = {
        id: callId,
        callerId: me.id,
        calleeId: callee.id,
        callerSocket: socket.id,
        calleeSocket: null,
        mode,
        media,
        status: 'ringing',
        ringTimer: setTimeout(() => endCall(callId, 'no_answer', { status: 'missed' }), RING_TIMEOUT_MS),
        billTimer: null,
      };
      calls.set(callId, live);
      userCall.set(me.id, callId);
      userCall.set(callee.id, callId);

      emitToUser(callee.id, 'call:incoming', {
        callId,
        from: publicView(me),
        media,
        mode,
        rate: mode === 'paid' ? rate : null,
      });
      ack({
        ok: true,
        callId,
        iceServers: ICE_SERVERS,
        callee: publicView(callee),
        rate: mode === 'paid' ? rate : null,
      });
    } catch (err) {
      console.error('call:start failed', err);
      ack({ error: 'Could not start the call' });
    }
  });

  socket.on('call:accept', ({ callId } = {}, ack = () => {}) => {
    const live = calls.get(Number(callId));
    if (!live || live.calleeId !== me.id || live.status !== 'ringing') return ack({ error: 'Call is no longer available' });
    clearTimeout(live.ringTimer);
    live.status = 'active';
    live.calleeSocket = socket.id;
    run("UPDATE calls SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = ?", live.id);

    // Other devices of the callee stop ringing.
    socket.to(`user:${me.id}`).emit('call:ended', { callId: live.id, reason: 'answered_elsewhere' });

    if (live.mode === 'paid') {
      if (!billNextMinute(live)) return ack({ error: 'Caller has insufficient balance' });
      live.billTimer = setInterval(() => billNextMinute(live), BILLING_INTERVAL_MS);
    }
    io.to(live.callerSocket).emit('call:accepted', { callId: live.id });
    ack({ ok: true, iceServers: ICE_SERVERS });
  });

  socket.on('call:reject', ({ callId } = {}) => {
    const live = calls.get(Number(callId));
    if (live && live.calleeId === me.id && live.status === 'ringing') endCall(live.id, 'rejected', { status: 'rejected' });
  });

  socket.on('call:end', ({ callId } = {}) => {
    const live = calls.get(Number(callId));
    if (live && (live.callerId === me.id || live.calleeId === me.id)) endCall(live.id, 'hangup');
  });

  // Relay SDP offers/answers and ICE candidates between the two connected devices only.
  socket.on('rtc:signal', ({ callId, data } = {}) => {
    const live = calls.get(Number(callId));
    if (!live || live.status !== 'active') return;
    const target = socket.id === live.callerSocket ? live.calleeSocket : socket.id === live.calleeSocket ? live.callerSocket : null;
    if (target) io.to(target).emit('rtc:signal', { callId: live.id, data });
  });

  socket.on('disconnect', () => {
    for (const live of calls.values()) {
      if (live.callerSocket === socket.id || live.calleeSocket === socket.id) endCall(live.id, 'disconnected');
    }
  });
}

/** For tests / graceful shutdown. */
export function endAllCalls(reason = 'shutdown') {
  for (const id of [...calls.keys()]) endCall(id, reason);
}
