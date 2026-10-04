import { photoUrl, tileUrl } from '../lib/api.js';

/**
 * The puzzle photo: a heavily pixelated preview under a grid of covers.
 * Revealed tiles are fetched one by one (the server refuses unearned tiles).
 */
export default function PhotoBoard({ user, revealed = [], grid = 3, full = false, justRevealed = [] }) {
  if (full) {
    return (
      <div className="board">
        <img className="board-full" src={photoUrl(user)} alt={user.name} />
      </div>
    );
  }
  return (
    <div className="board" style={{ '--grid': grid }}>
      <img className="board-blur" src={photoUrl(user, 'blur')} alt="" aria-hidden />
      <div className="board-grid">
        {Array.from({ length: grid * grid }, (_, i) =>
          revealed.includes(i) ? (
            <img key={i} className={`tile ${justRevealed.includes(i) ? 'tile-pop' : ''}`} src={tileUrl(user, i)} alt="" />
          ) : (
            <div key={i} className="tile tile-covered">
              <span>?</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
