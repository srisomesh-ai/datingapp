import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { api, photoUrl, timeAgo } from '../lib/api.js';

/** People who liked you: like back to match, or pass. */
function LikesYou({ likes, onChange }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  if (!likes.length) return null;

  async function answer(user, accept) {
    try {
      await api(`/likes/${user.id}/${accept ? 'accept' : 'decline'}`, { method: 'POST' });
      if (accept) {
        toast(`It's a match with ${user.name}! 🎉`, 'love');
        navigate(`/chats/${user.id}`);
      }
      onChange();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <section className="stack">
      <h3>Likes you ❤️ <span className="badge">{likes.length}</span></h3>
      {likes.map(({ user, message, likedAt }) => (
        <div key={user.id} className="card like-card">
          <img src={photoUrl(user)} alt={user.name} />
          <div className="grow stack">
            <div className="row-between">
              <strong>{user.name}, {user.age}</strong>
              <small className="muted">{timeAgo(likedAt)}</small>
            </div>
            <span className="muted small">{user.city}</span>
            {message ? <p className="like-message">💌 “{message}”</p> : <p className="muted small">Liked your profile</p>}
            <div className="row">
              <button className="btn small ghost" onClick={() => answer(user, false)}>Pass</button>
              <button className="btn small" onClick={() => answer(user, true)}>❤️ Like back</button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

export default function Chats() {
  const { socket, toast, setUnread } = useApp();
  const [data, setData] = useState(null);
  const [likes, setLikes] = useState([]);

  const load = useCallback(() => {
    api('/conversations')
      .then((d) => {
        setData(d.conversations);
        setUnread(d.conversations.reduce((n, c) => n + c.unread, 0));
      })
      .catch((e) => toast(e.message, 'error'));
    api('/likes')
      .then((d) => setLikes(d.likes))
      .catch(() => {});
  }, [toast, setUnread]);

  useEffect(() => {
    load();
    const events = ['message:new', 'like:new', 'match:new'];
    events.forEach((e) => socket?.on(e, load));
    return () => events.forEach((e) => socket?.off(e, load));
  }, [socket, load]);

  if (!data) return <div className="page center">Loading…</div>;
  return (
    <div className="page stack">
      <LikesYou likes={likes} onChange={load} />
      <h2>Chats</h2>
      {data.length === 0 && (
        <div className="card center stack">
          <p className="muted">When you and someone like each other, your chat opens here. Guess names in Discover to send likes with a message.</p>
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
                  <span className="muted ellipsis">{c.lastMessage ?? "It's a match! Say hi 👋"}</span>
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
