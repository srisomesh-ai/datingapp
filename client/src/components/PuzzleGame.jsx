import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import PhotoBoard from './PhotoBoard.jsx';
import { api, labelFor } from '../lib/api.js';

function Progress({ puzzle }) {
  return (
    <div className="progress">
      <span className="muted small">Right</span>
      <span className="grow">
        {Array.from({ length: puzzle.correctToSolve }, (_, i) => (
          <i key={i} className={i < puzzle.correct ? 'dot good' : 'dot'}>{i < puzzle.correct ? '✓' : ''}</i>
        ))}
      </span>
      <span className="muted small">Strikes</span>
      <span>
        {Array.from({ length: puzzle.maxWrong }, (_, i) => (
          <i key={i} className={i < puzzle.wrong ? 'dot bad' : 'dot'}>{i < puzzle.wrong ? '✕' : ''}</i>
        ))}
      </span>
    </div>
  );
}

function Revealed({ profile }) {
  return (
    <div className="stack">
      <p className="label">Hobbies</p>
      <div className="chips">{profile.hobbies?.map((h) => <span key={h} className="chip on">{h}</span>)}</div>
      <p className="label">Loves</p>
      <div className="chips">{profile.likes?.map((h) => <span key={h} className="chip on">{h}</span>)}</div>
    </div>
  );
}

/**
 * Photo puzzle for one person: answer questions about their hobbies & likes,
 * each right answer uncovers tiles; enough right answers reveal the photo and unlock chat.
 */
export default function PuzzleGame({ target, onNext, nextLabel = 'Next', onSkip }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [puzzle, setPuzzle] = useState(null);
  const [profile, setProfile] = useState(null);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);

  async function play() {
    setBusy(true);
    try {
      const res = await api(`/discover/${target.id}/puzzle`, { method: 'POST' });
      setPuzzle(res.puzzle);
      setProfile(res.profile);
    } catch (err) {
      toast(err.message, 'error');
      if (err.data?.puzzle) setPuzzle(err.data.puzzle);
    } finally {
      setBusy(false);
    }
  }

  async function answer(optionIndex) {
    if (busy || picked !== null) return;
    setBusy(true);
    setPicked(optionIndex);
    try {
      const res = await api(`/puzzles/${puzzle.attemptId}/answer`, {
        method: 'POST',
        body: { questionIndex: puzzle.question.index, optionIndex },
      });
      // Let the player see right/wrong before moving on.
      setPuzzle((p) => ({ ...p, lastResult: res.puzzle.lastResult, revealed: res.puzzle.revealed }));
      setTimeout(() => {
        setPuzzle(res.puzzle);
        if (res.profile) setProfile(res.profile);
        setPicked(null);
        setBusy(false);
      }, 900);
    } catch (err) {
      toast(err.message, 'error');
      setPicked(null);
      setBusy(false);
    }
  }

  const status = puzzle?.status;
  const revealed = puzzle?.revealed ?? target.puzzle?.revealed ?? [];
  const solved = status === 'solved';
  const shown = profile ?? target;

  return (
    <div className="stack">
      <div className="discover-card card">
        <PhotoBoard user={target} revealed={revealed} full={solved} justRevealed={puzzle?.lastResult?.newlyRevealed ?? []} />
        <div className="discover-info">
          <h2>
            {target.name}, {target.age}
          </h2>
          <p className="muted">{target.city} · {labelFor[target.lookingFor]}</p>
          {target.bio && <p>{target.bio}</p>}
        </div>
      </div>

      {!puzzle && (
        <div className="card stack">
          <p>
            🧩 Answer questions about {target.name}'s hobbies & likes. Each right answer uncovers part of the photo. Get{' '}
            <b>3 right</b> to reveal it fully and unlock messaging.
          </p>
          <div className="row">
            {onSkip && <button className="btn ghost" onClick={onSkip}>Skip</button>}
            <button className="btn" onClick={play} disabled={busy}>Play puzzle</button>
          </div>
        </div>
      )}

      {status === 'in_progress' && puzzle.question && (
        <div className="card stack">
          <Progress puzzle={puzzle} />
          <p className="muted">Question {puzzle.questionNumber} of {puzzle.totalQuestions}</p>
          <h3>{puzzle.question.prompt}</h3>
          <div className="options">
            {puzzle.question.options.map((opt, i) => {
              const r = puzzle.lastResult;
              let cls = 'option';
              if (picked !== null && r) {
                if (i === r.correctOption) cls += ' right';
                else if (i === picked) cls += ' wrong';
              } else if (i === picked) cls += ' picked';
              return (
                <button key={opt} className={cls} onClick={() => answer(i)} disabled={busy}>
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {solved && (
        <div className="card stack celebrate">
          <h3>🎉 You know {target.name} well! Photo revealed.</h3>
          <Revealed profile={shown} />
          <div className="row">
            {onNext && <button className="btn ghost" onClick={onNext}>{nextLabel}</button>}
            <button className="btn" onClick={() => navigate(`/chats/${target.id}`)}>Send a message</button>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="card stack">
          <h3>Out of strikes 😅</h3>
          <p className="muted">
            You can try {target.name}'s puzzle again{' '}
            {puzzle.retryAt
              ? `after ${new Date(puzzle.retryAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}`
              : 'later'}
            . Tiles you uncovered stay uncovered.
          </p>
          {onNext && <button className="btn" onClick={onNext}>{nextLabel}</button>}
        </div>
      )}
    </div>
  );
}
