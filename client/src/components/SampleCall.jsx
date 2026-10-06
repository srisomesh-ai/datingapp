import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useCall } from '../context/CallContext.jsx';

/** Spend coins on a short voice/video call with anyone; coins are only used if they accept. */
export default function SampleCall({ user, compact = false }) {
  const { user: me, meta } = useApp();
  const { startCall } = useCall();
  const cfg = meta?.sampleCall;
  if (!cfg) return null;
  const length = cfg.seconds < 60 ? `${cfg.seconds}-sec` : `${Math.round(cfg.seconds / 60)}-min`;
  const enough = (me.coins ?? 0) >= cfg.coins;

  return (
    <div className={`sample-call ${compact ? 'compact' : ''}`}>
      <span className="small">
        🪙 {cfg.coins} · {length} sample call{compact ? '' : ' (only if they accept)'}
      </span>
      {enough ? (
        <div className="row">
          <button className="btn small ghost" onClick={() => startCall(user, 'audio', 'sample')}>📞 Voice</button>
          <button className="btn small ghost" onClick={() => startCall(user, 'video', 'sample')}>🎥 Video</button>
        </div>
      ) : (
        <span className="muted small">
          You have 🪙 {me.coins ?? 0}. {compact ? '' : <Link to="/">Guess names to earn more.</Link>}
        </span>
      )}
    </div>
  );
}
