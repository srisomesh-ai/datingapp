import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { api, labelFor, photoUrl } from '../lib/api.js';

/**
 * Discover card: the photo and profile are visible, the name is hidden.
 * Guess it right for a coin and the chance to send one message with your like.
 */
export default function GuessCard({ profile, onDone }) {
  const { meta, toast, setUser } = useApp();
  const navigate = useNavigate();
  const [p, setP] = useState(profile);
  const [guess, setGuess] = useState(profile.guess);
  const [picked, setPicked] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [matched, setMatched] = useState(false);

  const guessed = guess.status !== 'pending';
  const maxLen = meta?.nameGuess?.messageMaxLength ?? 300;

  async function pick(i) {
    if (busy || guessed) return;
    setBusy(true);
    setPicked(i);
    try {
      const res = await api(`/discover/${p.id}/guess`, { method: 'POST', body: { optionIndex: i } });
      setGuess(res.guess);
      setP((prev) => ({ ...prev, ...res.profile }));
      setUser((u) => ({ ...u, coins: res.coins }));
      if (res.guess.status === 'correct') {
        toast(res.guess.coinsAwarded ? `+${res.guess.coinsAwarded} 🪙 You guessed it!` : 'Correct! (daily coin limit reached)', 'love');
      }
    } catch (err) {
      toast(err.message, 'error');
      setPicked(null);
    } finally {
      setBusy(false);
    }
  }

  async function like() {
    setBusy(true);
    try {
      const body = guess.status === 'correct' && message.trim() ? { message: message.trim() } : {};
      const res = await api(`/discover/${p.id}/like`, { method: 'POST', body });
      if (res.matched) setMatched(true);
      else {
        toast(body.message ? `Like and message sent to ${p.name} 💌` : `You liked ${p.name} ❤️`);
        onDone();
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    api(`/discover/${p.id}/skip`, { method: 'POST' }).catch(() => {});
    onDone();
  }

  const facts = [p.favoriteCuisine && `🍽 ${p.favoriteCuisine}`, p.weekendStyle && `🗓 ${p.weekendStyle}`, p.chronotype && (p.chronotype === 'Night owl' ? '🌙 Night owl' : '☀️ Morning person'), p.dreamDestination && `✈️ ${p.dreamDestination}`].filter(Boolean);

  if (matched) {
    return (
      <div className="card stack center celebrate match">
        <img className="match-photo" src={photoUrl(p)} alt={p.name} />
        <h2>It's a match! 🎉</h2>
        <p className="muted">You and {p.name} like each other. Chat and call for free.</p>
        <div className="row">
          <button className="btn ghost" onClick={onDone}>Keep exploring</button>
          <button className="btn" onClick={() => navigate(`/chats/${p.id}`)}>Say hi</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card discover-card">
        <div className="photo-wrap">
          <img className="discover-photo" src={photoUrl(p)} alt="" />
          {p.likesYou && <span className="likes-you">❤️ Likes you</span>}
          <div className="photo-caption">
            <h2 className={guessed ? '' : 'masked'}>
              {guessed ? p.name : p.nameMask}, {p.age}
            </h2>
            <span>{p.city}</span>
          </div>
        </div>
      </div>

      {!guessed && (
        <div className="card stack">
          <h3>Who is this? 🤔</h3>
          <p className="muted small">Guess the name right to earn 🪙 1 and send a message with your like. One try only!</p>
          <div className="options grid2">
            {guess.options.map((name, i) => (
              <button key={name} className={`option ${picked === i ? 'picked' : ''}`} disabled={busy} onClick={() => pick(i)}>
                {name}
              </button>
            ))}
          </div>
          <button className="btn ghost small" onClick={skip}>Skip</button>
        </div>
      )}

      {guessed && (
        <div className="card stack">
          <div className="options grid2">
            {guess.options.map((name, i) => {
              let cls = 'option';
              if (i === guess.correctOption) cls += ' right';
              else if (i === picked) cls += ' wrong';
              return <button key={name} className={cls} disabled>{name}</button>;
            })}
          </div>
          {guess.status === 'correct' ? (
            <>
              <h3>
                Yes, it's {p.name}! {guess.coinsAwarded ? `+${guess.coinsAwarded} 🪙` : ''}
              </h3>
              <textarea
                rows={2}
                maxLength={maxLen}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`Send ${p.name} one message with your like (optional)`}
              />
            </>
          ) : (
            <h3>Oops, it's {p.name}. No coin this time.</h3>
          )}
          <div className="row">
            <button className="btn ghost" onClick={skip} disabled={busy}>Skip</button>
            <button className="btn" onClick={like} disabled={busy}>
              {guess.status === 'correct' && message.trim() ? '💌 Send like' : '❤️ Like'}
            </button>
          </div>
        </div>
      )}

      <div className="card discover-info stack">
        <span className="muted small">{labelFor[p.lookingFor]}</span>
        {p.bio && <p>{p.bio}</p>}
        <div className="chips">
          {p.hobbies?.map((h) => <span key={h} className="chip">{h}</span>)}
          {p.likes?.map((h) => <span key={h} className="chip on">{h}</span>)}
        </div>
        {facts.length > 0 && <div className="chips">{facts.map((f) => <span key={f} className="chip small-chip">{f}</span>)}</div>}
      </div>
    </div>
  );
}
