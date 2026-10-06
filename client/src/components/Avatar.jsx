import { displayName, photoUrl } from '../lib/api.js';

export default function Avatar({ user, size = 48, online }) {
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {user?.hasPhoto ? (
        <img src={photoUrl(user)} alt={displayName(user)} />
      ) : (
        <span className="avatar-initial">{displayName(user)[0]}</span>
      )}
      {online && <span className="avatar-online" />}
    </div>
  );
}
