import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Tick from '../components/Tick.jsx';
import { api, displayName, rupees, timeAgo } from '../lib/api.js';

/** Call options for a connection: no free calls, so pay per minute or spend coins on one minute. */
function CallSheet({ other, media, onClose }) {
  const { user: me, meta } = useApp();
  const { startCall } = useCall();
  const rate = meta?.matchCall?.paisePerMinute ?? 500;
  const sample = meta?.sampleCall;
  const go = (mode) => {
    onClose();
    startCall(other, media, mode);
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card stack" onClick={(e) => e.stopPropagation()}>
        <h3>🎥 Video call {other.name}</h3>
        <button className="btn" onClick={() => go('match')}>
          Call for {rupees(rate)}/min · wallet {rupees(me.walletPaise)}
        </button>
        {sample && (
          <button className="btn ghost" disabled={(me.coins ?? 0) < sample.coins} onClick={() => go('sample')}>
            1 minute for 🪙 {sample.coins} · you have 🪙 {me.coins ?? 0}
          </button>
        )}
        <p className="fine">Billed per minute while you talk. Coins are used only if they answer.</p>
        <Link to="/wallet" className="small" onClick={onClose}>Add money</Link>
      </div>
    </div>
  );
}

export default function Chat() {
  const { userId } = useParams();
  const id = Number(userId);
  const navigate = useNavigate();
  const { user: me, socket, toast, setUser } = useApp();
  const [info, setInfo] = useState(null);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [callMedia, setCallMedia] = useState(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    let alive = true;
    api(`/messages/${id}`)
      .then((d) => {
        if (!alive) return;
        setInfo(d);
        setChat(d.chat);
        setMessages(d.messages);
        api(`/messages/${id}/read`, { method: 'POST' }).catch(() => {});
      })
      .catch((e) => {
        toast(e.message, 'error');
        navigate('/chats');
      });
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
  }, [id, socket, toast, navigate]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const res = await api(`/messages/${id}`, { method: 'POST', body: { body } });
      setMessages((m) => (m.some((x) => x.id === res.message.id) ? m : [...m, res.message]));
      setChat(res.chat);
    } catch (err) {
      setText(body);
      if (err.data?.code === 'chat_limit') setChat(err.data.chat);
      else toast(err.message, 'error');
    }
  }

  async function unlock() {
    setBusy(true);
    try {
      const res = await api(`/messages/${id}/unlock`, { method: 'POST' });
      setChat(res.chat);
      setUser((u) => ({ ...u, walletPaise: res.walletPaise }));
      toast('Chat unlocked. Message as much as you like! 💬');
    } catch (err) {
      toast(err.message, 'error');
      if (err.data?.code === 'insufficient_balance') navigate('/wallet');
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (!confirm(`End chat with ${displayName(info.user)}? They won't be able to message, call or see you again.`)) return;
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

  if (!info || !chat) return <div className="page center">Loading…</div>;
  const other = info.user;
  const limitReached = !chat.unlocked && chat.freeLeft <= 0;

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="icon" onClick={() => navigate('/chats')} aria-label="Back">←</button>
        <Avatar user={other} online={info.online} size={40} />
        <div className="grow">
          <strong>{other.name} <Tick user={other} /></strong>
          <div className="muted small">{info.online ? 'Online' : 'Offline'}</div>
        </div>
        {info.canMessage && (
          <>
            <button className="icon" onClick={() => setCallMedia('video')} aria-label="Video call">🎥</button>
          </>
        )}
        <button className="icon" onClick={() => setMenu(!menu)} aria-label="More">⋮</button>
        {menu && (
          <div className="menu">
            <button onClick={report}>Report</button>
            <button onClick={block}>End chat &amp; block</button>
          </div>
        )}
      </header>

      <div className="messages">
        <p className="muted center small">
          {info.via === 'accepted'
            ? info.guessedYou
              ? `💌 ${other.name} opened this chat after you tried to guess the name.`
              : `💌 You opened this chat with ${other.name}.`
            : info.guessedYou
              ? `🎉 ${other.name} guessed your name!`
              : `🎉 You guessed ${other.name}'s name!`}{' '}
          Say hi.
        </p>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === me.id ? 'mine' : ''}`}>
            {m.body}
            <small>{timeAgo(m.createdAt)}{m.senderId === me.id && m.readAt ? ' · seen' : ''}</small>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {!info.canMessage ? (
        <p className="muted center pad">You can't message this person.</p>
      ) : limitReached ? (
        <div className="unlock card stack center">
          <strong>You've used your {chat.freeTotal} free messages</strong>
          <span className="muted small">Unlock unlimited chat with {other.name}, paid once from your wallet.</span>
          <button className="btn" onClick={unlock} disabled={busy}>🔓 Unlock chat · {rupees(chat.unlockPricePaise)}</button>
        </div>
      ) : (
        <>
          {!chat.unlocked && (
            <div className={`free-left ${chat.freeLeft <= 3 ? 'low' : ''}`}>
              {chat.freeLeft} free message{chat.freeLeft === 1 ? '' : 's'} left
            </div>
          )}
          <form className="composer" onSubmit={send}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" maxLength={2000} />
            <button className="btn" disabled={!text.trim()}>Send</button>
          </form>
        </>
      )}

      {callMedia && <CallSheet other={other} media={callMedia} onClose={() => setCallMedia(null)} />}
    </div>
  );
}
