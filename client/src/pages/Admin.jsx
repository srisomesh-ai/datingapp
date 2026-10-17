import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api, photoUrl, rupees, timeAgo } from '../lib/api.js';

export default function Admin() {
  const { toast } = useApp();
  const [stats, setStats] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [verifications, setVerifications] = useState([]);
  const [reports, setReports] = useState([]);

  const load = useCallback(() => {
    api('/admin/stats').then(setStats).catch((e) => toast(e.message, 'error'));
    api('/admin/withdrawals').then((d) => setWithdrawals(d.withdrawals)).catch(() => {});
    api('/admin/verifications').then((d) => setVerifications(d.verifications)).catch(() => {});
    api('/admin/reports').then((d) => setReports(d.reports)).catch(() => {});
  }, [toast]);
  useEffect(load, [load]);

  const act = (p, msg) => p.then(() => (toast(msg), load())).catch((e) => toast(e.message, 'error'));

  if (!stats) return <div className="page center">Loading…</div>;
  return (
    <div className="page stack">
      <h2>Admin</h2>
      <div className="stats">
        <div className="card"><small>Users</small><b>{stats.users}</b></div>
        <div className="card"><small>Friends</small><b>{stats.friends}</b></div>
        <div className="card"><small>Verified ✓</small><b>{stats.verified}</b></div>
        <div className="card"><small>Names guessed</small><b>{stats.namesGuessed}</b></div>
        <div className="card"><small>Chats opened</small><b>{stats.connections}</b></div>
        <div className="card"><small>Chat unlocks</small><b>{stats.chatUnlocks} · {rupees(stats.chatUnlockPaise)}</b></div>
        <div className="card"><small>Coins earned</small><b>{stats.coinsEarned}</b></div>
        <div className="card"><small>Paid minutes</small><b>{stats.paidMinutes}</b></div>
        <div className="card"><small>Call revenue</small><b>{rupees(stats.grossCallPaise)}</b></div>
        <div className="card"><small>Platform fees</small><b>{rupees(stats.platformFeePaise)}</b></div>
        <div className="card"><small>Friend earnings</small><b>{rupees(stats.hostEarningsPaise)}</b></div>
        <div className="card"><small>Top-ups</small><b>{rupees(stats.topupsPaise)}</b></div>
        <div className="card"><small>Pending payouts</small><b>{rupees(stats.pendingWithdrawalsPaise)}</b></div>
      </div>

      <section className="card stack">
        <h3>Selfie verification {verifications.length > 0 && <span className="badge">{verifications.length}</span>}</h3>
        {verifications.length === 0 && <p className="muted small">Nothing to review.</p>}
        {verifications.map((v) => (
          <div key={v.id} className="verify-review stack">
            <div className="row-between small">
              <span><b>{v.user.name}</b>, {v.user.age} · {v.user.email}</span>
              <span className="muted">{timeAgo(v.createdAt)}</span>
            </div>
            <p className="small">Asked pose: {v.pose?.emoji} {v.pose?.text}</p>
            {v.photoChanged && <p className="small warn-card">Profile photo changed after this selfie</p>}
            <div className="verify-pair">
              <figure><img src={photoUrl(v.user)} alt="Profile photo" /><figcaption>Profile photo</figcaption></figure>
              <figure><img src={`/api/admin/verifications/${v.id}/selfie`} alt="Selfie" /><figcaption>Live selfie</figcaption></figure>
            </div>
            <div className="row">
              <button
                className="btn small ghost"
                onClick={() => {
                  const reason = prompt('Why is it rejected? (shown to the user)', "The selfie didn't match your photo or the pose");
                  if (reason !== null) act(api(`/admin/verifications/${v.id}`, { method: 'POST', body: { action: 'reject', reason } }), 'Rejected');
                }}
              >
                Reject
              </button>
              <button className="btn small" onClick={() => act(api(`/admin/verifications/${v.id}`, { method: 'POST', body: { action: 'approve' } }), 'Verified ✓')}>
                Approve ✓
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>Withdrawals</h3>
        {withdrawals.map((w) => (
          <div key={w.id} className="row-between small">
            <span>{w.name} · {rupees(w.amountPaise)} → {w.upiId} · {timeAgo(w.createdAt)}</span>
            {w.status === 'pending' ? (
              <span className="row">
                <button className="btn small" onClick={() => act(api(`/admin/withdrawals/${w.id}`, { method: 'POST', body: { action: 'paid' } }), 'Marked paid')}>Paid</button>
                <button className="btn small ghost" onClick={() => act(api(`/admin/withdrawals/${w.id}`, { method: 'POST', body: { action: 'rejected' } }), 'Rejected & refunded')}>Reject</button>
              </span>
            ) : (
              <span className={`status ${w.status}`}>{w.status}</span>
            )}
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>Reports</h3>
        {reports.map((r) => (
          <div key={r.id} className="stack small report">
            <div><b>{r.reporterName}</b> reported <b>{r.reportedName}</b> · {timeAgo(r.createdAt)} · {r.status}</div>
            <div className="muted">{r.reason}</div>
            {r.status === 'open' && (
              <div className="row">
                <button className="btn small ghost" onClick={() => act(api(`/admin/reports/${r.id}/close`, { method: 'POST' }), 'Closed')}>Dismiss</button>
                <button
                  className="btn small danger"
                  onClick={() => act(api(`/admin/users/${r.reportedId}/ban`, { method: 'POST', body: { banned: !r.reportedBanned } }).then(() => api(`/admin/reports/${r.id}/close`, { method: 'POST' })), r.reportedBanned ? 'Unbanned' : 'User banned')}
                >
                  {r.reportedBanned ? 'Unban' : 'Ban user'}
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
