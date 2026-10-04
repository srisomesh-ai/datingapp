import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import PuzzleGame from '../components/PuzzleGame.jsx';
import { api } from '../lib/api.js';

/** Play one specific person's puzzle (e.g. someone who already solved yours). */
export default function Play() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const [target, setTarget] = useState(null);

  useEffect(() => {
    api(`/users/${userId}`)
      .then((d) => setTarget({ ...d.user, puzzle: { revealed: d.revealedTiles } }))
      .catch((e) => toast(e.message, 'error'));
  }, [userId, toast]);

  if (!target) return <div className="page center">Loading…</div>;
  if (target.revealed) return <Navigate to={`/chats/${target.id}`} replace />;
  return (
    <div className="page">
      <PuzzleGame target={target} onNext={() => navigate(`/chats/${target.id}`)} nextLabel="Back to chat" />
    </div>
  );
}
