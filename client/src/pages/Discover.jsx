import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import PuzzleGame from '../components/PuzzleGame.jsx';
import { api } from '../lib/api.js';

export default function Discover() {
  const { user, toast } = useApp();
  const [profiles, setProfiles] = useState(null);
  const [index, setIndex] = useState(0);

  const load = useCallback(async () => {
    setProfiles(null);
    try {
      const { profiles } = await api('/discover');
      setProfiles(profiles);
      setIndex(0);
    } catch (err) {
      toast(err.message, 'error');
      setProfiles([]);
    }
  }, [toast]);

  useEffect(() => {
    if (user.profileComplete) load();
  }, [user.profileComplete, load]);

  if (!user.profileComplete) {
    return (
      <div className="page center stack">
        <div className="logo">🧩</div>
        <h2>Almost there!</h2>
        <p className="muted">Add a photo, your hobbies and likes to start playing puzzles.</p>
        <Link className="btn" to="/profile">Complete profile</Link>
      </div>
    );
  }
  if (!profiles) return <div className="page center">Finding people…</div>;

  const current = profiles[index];
  if (!current) {
    return (
      <div className="page center stack">
        <div className="logo">🌙</div>
        <h2>No new people right now</h2>
        <p className="muted">Check back soon, or meet someone in Find a Friend.</p>
        <button className="btn" onClick={load}>Refresh</button>
        <Link className="btn ghost" to="/friends">Find a Friend</Link>
      </div>
    );
  }

  const next = () => (index + 1 >= profiles.length ? load() : setIndex(index + 1));
  const skip = () => {
    api(`/discover/${current.id}/skip`, { method: 'POST' }).catch(() => {});
    next();
  };

  return (
    <div className="page">
      <PuzzleGame key={current.id} target={current} onNext={next} nextLabel="Next person" onSkip={skip} />
    </div>
  );
}
