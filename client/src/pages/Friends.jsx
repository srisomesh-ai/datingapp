import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { api, rupees } from '../lib/api.js';

const STATUS = { available: 'Available', busy: 'On a call', offline: 'Offline' };

export default function Friends() {
  const { user, meta, toast } = useApp();
  const { startCall, call } = useCall();
  const [gender, setGender] = useState('');
  const [friends, setFriends] = useState(null);

  const load = useCallback(() => {
    api(`/friends${gender ? `?gender=${gender}` : ''}`)
      .then((d) => setFriends(d.friends))
      .catch((e) => toast(e.message, 'error'));
  }, [gender, toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  // Refresh balances/status after a call ends.
  useEffect(() => {
    if (call.phase === 'ended') load();
  }, [call.phase, load]);

  if (!meta) return null;
  const r = meta.rates;

  return (
    <div className="page stack">
      <h2>Find a Friend</h2>
      <div className="card pricing">
        <p>Lonely or bored? Voice or video call a friendly person right now.</p>
        <div className="row">
          <div className="price"><b>{rupees(r.female.pricePaise)}</b><span>/ {r.female.minutes} min with a woman</span></div>
          <div className="price"><b>{rupees(r.male.pricePaise)}</b><span>/ {r.male.minutes} min with a man</span></div>
        </div>
        <p className="fine">
          Billed per minute from your wallet. Save up to {Math.max(...meta.packages.map((p) => p.discountPercent))}% with{' '}
          <Link to="/wallet">packages</Link>. Wallet: <b>{rupees(user.walletPaise)}</b>
        </p>
      </div>

      <div className="tabs">
        {[['', 'All'], ['female', 'Women'], ['male', 'Men']].map(([g, label]) => (
          <button key={g} className={gender === g ? 'active' : ''} onClick={() => setGender(g)}>{label}</button>
        ))}
      </div>

      {!friends && <p className="center muted">Loading…</p>}
      {friends?.length === 0 && <p className="center muted">No friends listed yet. Turn on Friend mode in your profile to be the first!</p>}

      <ul className="list">
        {friends?.map((f) => {
          const canCall = f.status === 'available';
          const short = f.affordableMinutes < 1;
          return (
            <li key={f.id} className="card friend">
              <Avatar user={f} unlocked size={64} online={f.status === 'available'} />
              <div className="grow">
                <div className="row-between">
                  <strong>{f.name}, {f.age}</strong>
                  <span className={`status ${f.status}`}>{STATUS[f.status]}</span>
                </div>
                <div className="muted small">{f.city}</div>
                {f.headline && <div className="small">{f.headline}</div>}
                <div className="small">
                  {rupees(f.rate.pricePaise)} / {f.rate.minutes} min · you can talk <b>{f.affordableMinutes} min</b>
                </div>
                <div className="row">
                  {short ? (
                    <Link to="/wallet" className="btn small">Add money to call</Link>
                  ) : (
                    <>
                      <button className="btn small ghost" disabled={!canCall} onClick={() => startCall(f, 'audio', 'paid')}>📞 Voice</button>
                      <button className="btn small" disabled={!canCall} onClick={() => startCall(f, 'video', 'paid')}>🎥 Video</button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="fine center">Be respectful. Calls may be ended and accounts banned for abuse. Report anyone who makes you uncomfortable.</p>
    </div>
  );
}
