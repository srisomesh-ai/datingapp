import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';

/**
 * Selfie verification: copy a random pose in a live camera selfie (no gallery
 * uploads), then an admin compares it with your profile photo.
 */
export default function Verify() {
  const { user, setUser, toast } = useApp();
  const navigate = useNavigate();
  const [pose, setPose] = useState(null);
  const [shot, setShot] = useState(null); // { blob, url }
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const status = user.verification?.status;
  const canStart = status === 'none' || status === 'rejected';

  useEffect(() => {
    if (!canStart || !user.hasPhoto) return undefined;
    let cancelled = false;
    api('/verification/pose', { method: 'POST' })
      .then((d) => !cancelled && setPose(d.pose))
      .catch((e) => toast(e.message, 'error'));
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setCameraError(true));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [canStart, user.hasPhoto, toast]);

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const canvas = Object.assign(document.createElement('canvas'), { width: 720, height: 720 });
    const ctx = canvas.getContext('2d');
    // Mirror like the preview so the pose matches what the person saw.
    ctx.translate(720, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 720, 720);
    canvas.toBlob((blob) => setShot({ blob, url: URL.createObjectURL(blob) }), 'image/jpeg', 0.85);
  }

  async function submit() {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('selfie', shot.blob, 'selfie.jpg');
      const { user: u } = await api('/verification', { method: 'POST', body: form });
      setUser(u);
      toast('Selfie sent! We will review it soon.');
      navigate('/profile');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!user.hasPhoto) {
    return (
      <div className="page center stack">
        <h2>Add a profile photo first</h2>
        <Link className="btn" to="/profile">Go to profile</Link>
      </div>
    );
  }
  if (status === 'verified') {
    return (
      <div className="page center stack">
        <div className="logo">✅</div>
        <h2>You're verified</h2>
        <p className="muted">The blue tick shows on your profile.</p>
      </div>
    );
  }
  if (status === 'pending') {
    return (
      <div className="page center stack">
        <div className="logo">⏳</div>
        <h2>Your selfie is being reviewed</h2>
        <p className="muted">You'll get a notification when it's done.</p>
      </div>
    );
  }

  return (
    <div className="page stack">
      <h2>Get verified <span className="tick">✓</span></h2>
      <p className="muted small">
        Take a live selfie doing the pose below. We compare it with your profile photo. Verified people get a blue tick, and some
        people only let verified people guess their name.
      </p>
      {status === 'rejected' && user.verification?.note && <p className="card small warn-card">Last try: {user.verification.note}</p>}
      {pose && (
        <div className="card pose">
          <span className="pose-emoji">{pose.emoji}</span>
          <strong>{pose.text}</strong>
        </div>
      )}
      <div className="selfie-frame">
        {cameraError ? (
          <p className="muted center pad">Allow camera access to take your selfie.</p>
        ) : (
          // Kept mounted while previewing the shot so "Retake" has the camera ready.
          <video ref={videoRef} autoPlay playsInline muted style={{ display: shot ? 'none' : 'block' }} />
        )}
        {shot && <img src={shot.url} alt="Your selfie" />}
      </div>
      {shot ? (
        <div className="row">
          <button className="btn ghost" onClick={() => setShot(null)} disabled={busy}>Retake</button>
          <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send for review'}</button>
        </div>
      ) : (
        <button className="btn" onClick={capture} disabled={cameraError || !pose}>📸 Take selfie</button>
      )}
      <p className="fine">Your selfie is only seen by our review team, never shown on your profile.</p>
    </div>
  );
}
