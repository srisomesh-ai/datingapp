import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { api, photoUrl, timeAgo } from '../lib/api.js';

/** "7 people tried to guess your name today" + the people who guessed wrong (you can still open a chat). */
function TriedToGuess({ stats, people, onChange }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  if (!stats) return null;
  async function startChat(user) {
    try {
      await api(`/who-tried/${user.id}/chat`, { method: 'POST' });
      toast(`Chat opened with ${user.name} 💬`, 'love');
      navigate(`/chats/${user.id}`);
    } catch (err) {
      toast(err.message, 'error');
      onChange();
    }
  }
  return (
    <section className="card stack tried">
      <div className="tried-stats">
        <span className="big">👀 {stats.today.tried}</span>
        <span>
          {stats.today.tried === 1 ? 'person' : 'people'} tried to guess your name today
          {stats.today.correct > 0 && <> · <b>{stats.today.correct}</b> got it right</>}
        </span>
      </div>
      {people.length > 0 && (
        <>
          <p className="label">Tried but guessed wrong. You can still say hi:</p>
          <div className="tried-list">
            {people.map(({ user, triedAt }) => (
              <div key={user.id} className="tried-person">
                <img src={photoUrl(user)} alt={user.name} />
                <strong>{user.name}, {user.age}</strong>
                <small className="muted">{timeAgo(triedAt)}</small>
                <button className="btn small" onClick={() => startChat(user)}>💬 Start chat</button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function Chats() {
  const { socket, toast, setUnread } = useApp();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [tried, setTried] = useState([]);

  const load = useCallback(() => {
    api('/conversations')
      .then((d) => {
        setData(d.conversations);
        setUnread(d.conversations.reduce((n, c) => n + c.unread, 0));
      })
      .catch((e) => toast(e.message, 'error'));
    api('/guess-stats').then(setStats).catch(() => {});
    api('/who-tried').then((d) => setTried(d.people)).catch(() => {});
  }, [toast, setUnread]);

  useEffect(() => {
    load();
    const events = ['message:new', 'guess:correct', 'guess:attempt', 'guess:accepted'];
    events.forEach((e) => socket?.on(e, load));
    return () => events.forEach((e) => socket?.off(e, load));
  }, [socket, load]);

  if (!data) return <div className="page center">Loading…</div>;
  return (
    <div className="page stack">
      <TriedToGuess stats={stats} people={tried} onChange={load} />
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
                  <span className="muted ellipsis">{c.lastMessage ?? (c.via === 'accepted' ? (c.guessedYou ? '💌 Opened a chat with you! Say hi' : '💌 You opened this chat. Say hi') : c.guessedYou ? '🎉 Guessed your name! Say hi' : '🎉 You guessed their name! Say hi')}</span>
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
