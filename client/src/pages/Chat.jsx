import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import Avatar from '../components/Avatar.jsx';
import SampleCall from '../components/SampleCall.jsx';
import { api, displayName, timeAgo } from '../lib/api.js';

export default function Chat() {
  const { userId } = useParams();
  const id = Number(userId);
  const navigate = useNavigate();
  const { user: me, socket, toast } = useApp();
  const { startCall } = useCall();
  const [info, setInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    let alive = true;
    api(`/messages/${id}`)
      .then((d) => {
        if (!alive) return;
        setInfo(d);
        setMessages(d.messages);
        api(`/messages/${id}/read`, { method: 'POST' }).catch(() => {});
      })
      .catch((e) => toast(e.message, 'error'));
    const onNew = ({ message }) => {
      if (message.senderId === id || message.receiverId === id) {
        setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message]));
        if (message.senderId === id) api(`/messages/${id}/read`, { method: 'POST' }).catch(() => {});
      }
    };
    socket?.on('message:new', onNew);
    return () => {
      alive = false;
      socket?.off('message:new', onNew);
    };
  }, [id, socket, toast]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const { message } = await api(`/messages/${id}`, { method: 'POST', body: { body } });
      setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message]));
    } catch (err) {
      setText(body);
      toast(err.message, 'error');
    }
  }

  async function block() {
    if (!confirm(`Block ${displayName(info.user)}? They won't be able to message or call you.`)) return;
    await api(`/users/${id}/block`, { method: 'POST' });
    toast('Blocked');
    navigate('/chats');
  }

  async function report() {
    const reason = prompt('What happened? Our team will review it.');
    if (!reason) return;
    await api(`/users/${id}/report`, { method: 'POST', body: { reason } });
    toast('Thanks, we will review this report');
    setMenu(false);
  }

  if (!info) return <div className="page center">Loading…</div>;
  const other = info.user;

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="icon" onClick={() => navigate('/chats')} aria-label="Back">←</button>
        <Avatar user={other} online={info.online} size={40} />
        <div className="grow">
          <strong>{displayName(other)}</strong>
          <div className="muted small">{info.online ? 'Online' : 'Offline'}</div>
        </div>
        {info.canMessage && (
          <>
            <button className="icon" onClick={() => startCall(other, 'audio', 'free')} aria-label="Voice call">📞</button>
            <button className="icon" onClick={() => startCall(other, 'video', 'free')} aria-label="Video call">🎥</button>
          </>
        )}
        <button className="icon" onClick={() => setMenu(!menu)} aria-label="More">⋮</button>
        {menu && (
          <div className="menu">
            <button onClick={report}>Report</button>
            <button onClick={block}>Block</button>
          </div>
        )}
      </header>


      <div className="messages">
        {messages.length === 0 && info.canMessage && <p className="muted center">It's a match! Break the ice 🧊</p>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === me.id ? 'mine' : ''}`}>
            {m.body}
            <small>{timeAgo(m.createdAt)}{m.senderId === me.id && m.readAt ? ' · seen' : ''}</small>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {info.canMessage ? (
        <form className="composer" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" maxLength={2000} />
          <button className="btn" disabled={!text.trim()}>Send</button>
        </form>
      ) : (
        <div className="pad stack center">
          <p className="muted">
            {info.waitingForLikeBack
              ? `❤️ Like sent. You can chat once ${displayName(other)} likes you back.`
              : 'You can chat once you both like each other.'}
          </p>
          <SampleCall user={other} />
        </div>
      )}
    </div>
  );
}
