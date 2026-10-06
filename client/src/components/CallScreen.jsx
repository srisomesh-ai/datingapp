import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import { displayName, rupees } from '../lib/api.js';
import Avatar from './Avatar.jsx';

function Video({ stream, muted, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function useElapsedSeconds(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const END_REASONS = {
  hangup: 'Call ended',
  rejected: 'Call declined',
  no_answer: 'No answer',
  insufficient_balance: 'Balance ran out',
  disconnected: 'Connection lost',
  billing_error: 'Call ended',
  shutdown: 'Call ended',
  time_up: 'Your sample minute is over',
  insufficient_coins: 'Not enough coins',
};

export default function CallScreen() {
  const { call, localStream, remoteStream, muted, cameraOff, accept, reject, hangup, dismiss, toggleMute, toggleCamera, switchCamera } = useCall();
  const { meta } = useApp();
  const seconds = useElapsedSeconds(call.phase === 'active' ? call.startedAt : null);

  if (call.phase === 'idle') return null;
  const peer = call.peer ?? {};
  const isVideo = call.media === 'video';
  const paid = call.mode === 'paid';
  const sample = call.mode === 'sample';
  const name = displayName(peer);

  if (call.phase === 'incoming') {
    return (
      <div className="call-overlay">
        <div className="call-center">
          <Avatar user={peer} size={120} />
          <h2>{name}</h2>
          <p className="muted">
            Incoming {isVideo ? 'video' : 'voice'} call{paid ? ' · paid friend call' : ''}{sample ? ' · 1-minute sample call' : ''}
          </p>
          {paid && call.rate && (
            <p className="pill">
              You earn {rupees(Math.round((call.rate.paisePerMinute * (100 - (meta?.platformFeePercent ?? 25))) / 100))}/min
            </p>
          )}
        </div>
        <div className="call-actions">
          <button className="round danger" onClick={reject} aria-label="Decline">✕</button>
          <button className="round success" onClick={accept} aria-label="Accept">{isVideo ? '🎥' : '📞'}</button>
        </div>
      </div>
    );
  }

  if (call.phase === 'ended') {
    const s = call.summary ?? {};
    return (
      <div className="call-overlay">
        <div className="call-center">
          <Avatar user={peer} size={96} />
          <h2>{END_REASONS[s.reason] ?? 'Call ended'}</h2>
          {s.billedMinutes > 0 && (
            <div className="card summary">
              <div>Billed minutes: <b>{s.billedMinutes}</b></div>
              {call.role === 'caller' ? (
                <div>You paid: <b>{rupees(s.callerPaidPaise)}</b></div>
              ) : (
                <div>You earned: <b>{rupees(s.hostEarnedPaise)}</b></div>
              )}
            </div>
          )}
          {s.coinsSpent > 0 && call.role === 'caller' && (
            <div className="card summary">
              <div>Sample call · used <b>🪙 {s.coinsSpent}</b></div>
              <div className="muted small">Liked each other? Matches call free, with no time limit.</div>
            </div>
          )}
          {s.reason === 'insufficient_balance' && call.role === 'caller' && (
            <Link to="/wallet" className="btn" onClick={dismiss}>Add money</Link>
          )}
          <button className="btn ghost" onClick={dismiss}>Close</button>
        </div>
      </div>
    );
  }

  const b = call.billing;
  return (
    <div className={`call-overlay ${isVideo ? 'video' : ''}`}>
      {isVideo && <Video stream={remoteStream} className="remote-video" />}
      {!isVideo && <audio ref={(el) => el && (el.srcObject = remoteStream)} autoPlay />}
      {isVideo && localStream && <Video stream={localStream} muted className={`local-video ${cameraOff ? 'off' : ''}`} />}

      <div className="call-top">
        <strong>{name}</strong>
        <span>{call.phase === 'outgoing' ? 'Ringing…' : clock(seconds)}</span>
        {sample && call.phase === 'active' && call.limitSeconds && (
          <span className={`pill ${call.limitSeconds - seconds <= 10 ? 'pill-warn' : ''}`}>
            ⏳ {clock(Math.max(0, call.limitSeconds - seconds))} left · sample call
          </span>
        )}
        {paid && call.phase === 'active' && b && (
          <span className="pill">
            {call.role === 'caller'
              ? `${rupees(b.paidPaise ?? 0)} · ${b.minutesLeft} min left`
              : `Earned ${rupees(b.earnedPaise ?? 0)}`}
          </span>
        )}
      </div>

      {(!isVideo || call.phase === 'outgoing' || !remoteStream) && (
        <div className="call-center">
          <Avatar user={peer} size={120} />
          <p className="muted">{call.phase === 'outgoing' ? `Calling ${name}…` : remoteStream ? 'Connected' : 'Connecting…'}</p>
        </div>
      )}

      <div className="call-actions">
        <button className={`round ${muted ? 'on' : ''}`} onClick={toggleMute} aria-label="Mute">{muted ? '🔇' : '🎙️'}</button>
        {isVideo && (
          <>
            <button className={`round ${cameraOff ? 'on' : ''}`} onClick={toggleCamera} aria-label="Camera">{cameraOff ? '🚫' : '📷'}</button>
            <button className="round" onClick={switchCamera} aria-label="Switch camera">🔄</button>
          </>
        )}
        <button className="round danger" onClick={hangup} aria-label="Hang up">✕</button>
      </div>
    </div>
  );
}
