import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { api, photoUrl } from '../lib/api.js';
import { preparePhoto } from '../lib/photo.js';

function Chips({ options, value, onChange, max }) {
  const toggle = (opt) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else if (value.length < max) onChange([...value, opt]);
  };
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o} className={`chip ${value.includes(o) ? 'on' : ''}`} onClick={() => toggle(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Choice({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o} className={`chip ${value === o ? 'on' : ''}`} onClick={() => onChange(value === o ? null : o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** Blue tick status + link to the selfie check. */
function VerificationStatus({ user }) {
  const v = user.verification ?? {};
  if (v.status === 'verified') return <p className="small"><span className="tick">✓</span> Verified with a live selfie</p>;
  if (v.status === 'pending') return <p className="small muted">⏳ Your verification selfie is being reviewed</p>;
  return (
    <div className="verify-cta">
      <span className="small">
        {v.note ? `${v.note} ` : ''}Get a blue tick <span className="tick">✓</span>: people trust verified profiles more.
      </span>
      <Link className="btn small" to="/verify">Verify me</Link>
    </div>
  );
}

export default function Profile() {
  const { user, setUser, meta, toast, logout } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (user && !form) {
      setForm({
        name: user.name,
        bio: user.bio,
        city: user.city,
        interestedIn: user.interestedIn,
        lookingFor: user.lookingFor,
        hobbies: user.hobbies,
        likes: user.likes,
        favoriteCuisine: user.favoriteCuisine,
        weekendStyle: user.weekendStyle,
        chronotype: user.chronotype,
        dreamDestination: user.dreamDestination,
        hostHeadline: user.hostHeadline,
        guessMinAge: user.guessMinAge ?? '',
        guessMaxAge: user.guessMaxAge ?? '',
        dailyChatLimit: user.dailyChatLimit,
        guessVerifiedOnly: user.guessVerifiedOnly,
      });
    }
  }, [user, form]);

  if (!form || !meta) return <div className="page center">Loading…</div>;
  const c = meta.catalog;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { form: data, previewUrl } = await preparePhoto(file);
      setPreview(previewUrl);
      const { user: u } = await api('/profile/photo', { method: 'POST', body: data });
      setUser(u);
      toast('Photo updated');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    const missing = [];
    if (form.hobbies.length < meta.profileMin.hobbies) missing.push(`at least ${meta.profileMin.hobbies} hobbies`);
    if (form.likes.length < meta.profileMin.likes) missing.push(`at least ${meta.profileMin.likes} likes`);
    if (missing.length) return toast(`Please pick ${[...new Set(missing)].join(', ')}`, 'warn');
    setSaving(true);
    try {
      const { hostHeadline, ...profile } = form;
      let { user: u } = await api('/profile', { method: 'PUT', body: profile });
      if (u.isHost) ({ user: u } = await api('/friends/me', { method: 'PUT', body: { hostHeadline } }));
      setUser(u);
      toast('Profile saved');
      if (u.profileComplete && !user.profileComplete) navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setHost(body) {
    try {
      const { user: u } = await api('/friends/me', { method: 'PUT', body });
      setUser(u);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const fee = meta.platformFeePercent;
  return (
    <form className="page stack" onSubmit={save}>
      <h2>{user.profileComplete ? 'Your profile' : 'Set up your profile'}</h2>
      {!user.profileComplete && (
        <p className="muted">
          People see your photo and profile but not your name. If someone guesses your name right, you're notified and a chat opens for both of you.
        </p>
      )}

      <section className="card stack">
        <h3>Photo</h3>
        <div className="photo-upload">
          {preview || user.hasPhoto ? <img src={preview ?? photoUrl(user)} alt="You" /> : <div className="photo-empty">No photo yet</div>}
          <label className="btn ghost">
            {uploading ? 'Uploading…' : user.hasPhoto ? 'Change photo' : 'Add photo'}
            <input type="file" accept="image/*" hidden onChange={onPhoto} disabled={uploading} />
          </label>
        </div>
        <p className="fine">Use a clear photo of your face.{user.verified && ' Changing it removes your blue tick until you verify again.'}</p>
        <VerificationStatus user={user} />
      </section>

      <section className="card stack">
        <h3>About you</h3>
        <label>Name<input value={form.name} onChange={set('name')} maxLength={40} /></label>
        <label>City<input value={form.city} onChange={set('city')} maxLength={60} /></label>
        <label>Bio<textarea value={form.bio} onChange={set('bio')} maxLength={500} rows={3} placeholder="A line or two about you" /></label>
        <label>
          Looking for
          <select value={form.lookingFor} onChange={set('lookingFor')}>
            <option value="soulmate">A soulmate 💗</option>
            <option value="friend">Friends 🤝</option>
            <option value="both">Both</option>
          </select>
        </label>
        <label>
          Show me
          <select value={form.interestedIn} onChange={set('interestedIn')}>
            <option value="everyone">Everyone</option>
            <option value="female">Women</option>
            <option value="male">Men</option>
          </select>
        </label>
      </section>

      <section className="card stack">
        <h3>Hobbies <small className="muted">({form.hobbies.length}/8, min {meta.profileMin.hobbies})</small></h3>
        <Chips options={c.hobbies} value={form.hobbies} onChange={set('hobbies')} max={8} />
      </section>

      <section className="card stack">
        <h3>Things you love <small className="muted">({form.likes.length}/8, min {meta.profileMin.likes})</small></h3>
        <Chips options={c.likes} value={form.likes} onChange={set('likes')} max={8} />
      </section>

      <section className="card stack">
        <h3>Fun facts <small className="muted">(optional)</small></h3>
        <p className="label">Favourite cuisine</p>
        <Choice options={c.cuisines} value={form.favoriteCuisine} onChange={set('favoriteCuisine')} />
        <p className="label">Perfect weekend</p>
        <Choice options={c.weekendStyles} value={form.weekendStyle} onChange={set('weekendStyle')} />
        <p className="label">Morning or night?</p>
        <Choice options={c.chronotypes} value={form.chronotype} onChange={set('chronotype')} />
        <p className="label">Dream holiday</p>
        <Choice options={c.destinations} value={form.dreamDestination} onChange={set('dreamDestination')} />
      </section>

      <section className="card stack">
        <h3>🛡️ Safety</h3>
        <p className="muted small">You decide who can guess your name and how many new chats can start with you each day.</p>
        <p className="label">Who can guess me (age)</p>
        <div className="row">
          <input type="number" min={meta.safety?.minAge ?? 18} max={meta.safety?.maxAge ?? 99} placeholder="Min" value={form.guessMinAge} onChange={set('guessMinAge')} />
          <span className="muted">to</span>
          <input type="number" min={meta.safety?.minAge ?? 18} max={meta.safety?.maxAge ?? 99} placeholder="Max" value={form.guessMaxAge} onChange={set('guessMaxAge')} />
        </div>
        <label className="switch">
          <input type="checkbox" checked={Boolean(form.guessVerifiedOnly)} onChange={(e) => set('guessVerifiedOnly')(e.target.checked)} />
          <span>Only verified people <span className="tick">✓</span> can guess my name</span>
        </label>
        <label>
          New chats per day
          <select value={form.dailyChatLimit} onChange={(e) => set('dailyChatLimit')(Number(e.target.value))}>
            {(meta.safety?.dailyChatOptions ?? [3, 5, 10, 20, 50]).map((n) => (
              <option key={n} value={n}>{n} per day</option>
            ))}
          </select>
        </label>
        <p className="fine">When the limit is reached you're hidden from Discover until tomorrow.</p>
      </section>

      {user.profileComplete && (
        <section className="card stack">
          <h3>Be a Friend & earn</h3>
          <p className="muted">
            List yourself in <b>Find a Friend</b>. People pay to video call you and you keep {100 - fee}% of every minute
            ({fee}% platform fee). Your photo is visible to callers.
          </p>
          {!user.verified && meta.verification?.hostsMustBeVerified && !user.isHost ? (
            <p className="small">
              Friends must be verified first. <Link to="/verify">Get your blue tick ✓</Link>
            </p>
          ) : (
            <label className="switch">
              <input type="checkbox" checked={user.isHost} onChange={(e) => setHost({ isHost: e.target.checked })} />
              <span>Friend mode {user.isHost ? 'on' : 'off'}</span>
            </label>
          )}
          {user.isHost && (
            <>
              <label className="switch">
                <input type="checkbox" checked={user.hostAvailable} onChange={(e) => setHost({ hostAvailable: e.target.checked })} />
                <span>{user.hostAvailable ? 'Available for calls' : 'Not taking calls'}</span>
              </label>
              <label>
                Headline
                <input value={form.hostHeadline} onChange={set('hostHeadline')} maxLength={80} placeholder="e.g. Let's talk movies & music" />
              </label>
            </>
          )}
        </section>
      )}

      <button className="btn sticky" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
      <button type="button" className="btn ghost" onClick={logout}>Log out</button>
    </form>
  );
}
