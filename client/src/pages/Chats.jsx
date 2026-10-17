import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { api, timeAgo } from '../lib/api.js';

export default function Chats() {
  const { socket, toast, setUnread } = useApp();
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    api('/conversations')
      .then((d) => {
        setData(d.conversations);
        setUnread(d.conversations.reduce((n, c) => n + c.unread, 0));
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast, setUnread]);

  useEffect(() => {
    load();
    const events = ['message:new', 'guess:correct'];
    events.forEach((e) => socket?.on(e, load));
    return () => events.forEach((e) => socket?.off(e, load));
  }, [socket, load]);

  if (!data) return <div className="page center">Loading…</div>;
  return (
    <div className="page stack">
      <h2>Chats</h2>
      {data.length === 0 && (
        <div className="card center stack">
          <p className="muted">Guess someone's name right in Discover and your chat opens here. When someone guesses yours, they show up here too.</p>
          <Link to="/" className="btn">Discover people</Link>
        </div>
      )}
      <ul className="list">
        {data.map((c) => (
          <li key={c.user.id}>
            <Link to={`/chats/${c.user.id}`} className="list-item">
              <Avatar user={c.user} online={c.online} />
              <div className="grow">
                <div className="row-between">
                  <strong>{c.user.name}</strong>
                  <small className="muted">{timeAgo(c.lastAt)}</small>
                </div>
                <div className="row-between">
                  <span className="muted ellipsis">{c.lastMessage ?? (c.guessedYou ? '🎉 Guessed your name! Say hi' : '🎉 You guessed their name! Say hi')}</span>
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
