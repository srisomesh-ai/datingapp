import { photoUrl } from '../lib/api.js';

/** Round avatar. Shows the pixelated preview with a lock when the photo isn't unlocked yet. */
export default function Avatar({ user, unlocked, size = 48, online }) {
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {user?.hasPhoto ? (
        <img src={photoUrl(user, unlocked ? 'full' : 'blur')} alt={user.name} className={unlocked ? '' : 'avatar-blur'} />
      ) : (
        <span className="avatar-initial">{user?.name?.[0] ?? '?'}</span>
      )}
      {!unlocked && user?.hasPhoto && <span className="avatar-lock">🔒</span>}
      {online && <span className="avatar-online" />}
    </div>
  );
}
