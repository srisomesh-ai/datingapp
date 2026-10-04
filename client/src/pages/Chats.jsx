import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { api, timeAgo } from '../lib/api.js';

export default function Chats() {
  const { socket, toast, setUnread } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api('/conversations')
        .then((d) => {
          if (!alive) return;
          setData(d.conversations);
          setUnread(d.conversations.reduce((n, c) => n + c.unread, 0));
        })
        .catch((e) => toast(e.message, 'error'));
    load();
    socket?.on('message:new', load);
    socket?.on('puzzle:solved', load);
    return () => {
      alive = false;
      socket?.off('message:new', load);
      socket?.off('puzzle:solved', load);
    };
  }, [socket, toast, setUnread]);

  if (!data) return <div className="page center">Loading…</div>;
  return (
    <div className="page stack">
      <h2>Chats</h2>
      {data.length === 0 && (
        <div className="card center stack">
          <p className="muted">Solve someone's photo puzzle to start chatting. When someone solves yours, they'll show up here too.</p>
          <Link to="/" className="btn">Play puzzles</Link>
        </div>
      )}
      <ul className="list">
        {data.map((c) => (
          <li key={c.user.id}>
            <Link to={`/chats/${c.user.id}`} className="list-item">
              <Avatar user={c.user} unlocked={c.canSeePhoto} online={c.online} />
              <div className="grow">
                <div className="row-between">
                  <strong>{c.user.name}</strong>
                  <small className="muted">{timeAgo(c.lastAt)}</small>
                </div>
                <div className="row-between">
                  <span className="muted ellipsis">{c.lastMessage ?? (c.canSeePhoto ? 'Say hi 👋' : 'Solved your puzzle! Say hi 👋')}</span>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
