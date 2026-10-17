import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { api, labelFor, photoUrl } from '../lib/api.js';

/**
 * Discover card: see the photo, pick the right name. A right guess opens a chat
 * for both of you (and they get notified); a wrong one can be retried tomorrow.
 */
export default function GuessCard({ profile, onDone }) {
  const { toast, setUser } = useApp();
  const navigate = useNavigate();
  const [p, setP] = useState(profile);
  const [guess, setGuess] = useState(profile.guess);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);

  async function pick(i) {
    if (busy || guess.status !== 'pending') return;
    setBusy(true);
    setPicked(i);
    try {
      const res = await api(`/discover/${p.id}/guess`, { method: 'POST', body: { optionIndex: i } });
      setGuess(res.guess);
      setP((prev) => ({ ...prev, ...res.profile }));
      setUser((u) => ({ ...u, coins: res.coins }));
    } catch (err) {
      toast(err.message, 'error');
      setPicked(null);
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    api(`/discover/${p.id}/skip`, { method: 'POST' }).catch(() => {});
    onDone();
  }

  const right = guess.status === 'correct';
  const their = p.gender === 'female' ? 'her' : p.gender === 'male' ? 'his' : 'their';
  const wrong = guess.status === 'wrong';

  return (
    <div className="stack">
      <div className="card discover-card">
        <div className="photo-wrap">
          <img className="discover-photo" src={photoUrl(p)} alt="" />
          <div className="photo-caption">
            <h2 className={right ? '' : 'masked'}>
              {right ? p.name : p.nameMask}, {p.age}
            </h2>
            <span>{p.city}</span>
          </div>
        </div>
      </div>

      <div className="card stack">
        {guess.status === 'pending' && (
          <>
            <h3>What's {their} name? 🤔</h3>
            <p className="muted small">Look at the letters on the photo and pick the right name. Guess it right and your chat opens!</p>
          </>
        )}
        <div className="options grid2">
          {guess.options.map((name, i) => {
            let cls = 'option';
            if (right && i === guess.correctOption) cls += ' right';
            else if (wrong && i === picked) cls += ' wrong';
            else if (busy && i === picked) cls += ' picked';
            return (
              <button key={name} className={cls} disabled={busy || guess.status !== 'pending'} onClick={() => pick(i)}>
                {name}
              </button>
            );
          })}
        </div>

        {guess.status === 'pending' && <button className="btn ghost small" onClick={skip}>Skip</button>}

        {right && (
          <div className="stack center">
            <h3>🎉 Yes, it's {p.name}! {guess.coinsAwarded ? `+${guess.coinsAwarded} 🪙` : ''}</h3>
            <p className="muted small">{p.name} has been told you guessed {their} name. Your chat is open.</p>
            <div className="row">
              <button className="btn ghost" onClick={onDone}>Next</button>
              <button className="btn" onClick={() => navigate(`/chats/${p.id}`)}>💬 Say hi</button>
            </div>
          </div>
        )}

        {wrong && (
          <div className="stack center">
            <h3>Not quite 😅</h3>
            <p className="muted small">You can try {p.nameMask} again tomorrow.</p>
            <button className="btn" onClick={onDone}>Next person</button>
          </div>
        )}
      </div>

      <div className="card discover-info stack">
        <span className="muted small">{labelFor[p.lookingFor]}</span>
        {p.bio && <p>{p.bio}</p>}
        <div className="chips">
          {p.hobbies?.map((h) => <span key={h} className="chip">{h}</span>)}
          {p.likes?.map((h) => <span key={h} className="chip on">{h}</span>)}
        </div>
      </div>
    </div>
  );
}
