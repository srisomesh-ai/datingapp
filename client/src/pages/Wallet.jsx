import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api, rupees, timeAgo, displayName } from '../lib/api.js';

const TX_LABEL = {
  topup: 'Added money',
  package_purchase: 'Bought package',
  call_charge: 'Friend call',
  call_minute: 'Package minute used',
  call_earning: 'Call earnings',
  withdrawal: 'Withdrawal',
  withdrawal_reversed: 'Withdrawal reversed',
  name_guess: 'Guessed a name',
  sample_call: '1-min sample call',
  demo_bonus: 'Demo bonus',
};

function txAmount(t) {
  if (t.account === 'package') return `${t.amountPaise} min`;
  if (t.account === 'coins') return `${t.amountPaise > 0 ? '+' : ''}${t.amountPaise} 🪙`;
  return `${t.amountPaise > 0 ? '+' : '−'}${rupees(Math.abs(t.amountPaise))}`;
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load payment page'));
    document.body.appendChild(s);
  });
}

export default function Wallet() {
  const { user, meta, toast, refreshUser } = useApp();
  const [w, setW] = useState(null);
  const [amount, setAmount] = useState(200);
  const [withdraw, setWithdraw] = useState({ amountRupees: '', upiId: '' });
  const [tab, setTab] = useState('female');
  const [busy, setBusy] = useState(false);
  const [calls, setCalls] = useState([]);

  const load = useCallback(() => {
    api('/wallet').then(setW).catch((e) => toast(e.message, 'error'));
    api('/calls').then((d) => setCalls(d.calls)).catch(() => {});
  }, [toast]);
  useEffect(load, [load]);

  async function after(promise, msg) {
    setBusy(true);
    try {
      await promise;
      toast(msg);
      load();
      refreshUser();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function topup() {
    setBusy(true);
    try {
      const order = await api('/wallet/topup/order', { method: 'POST', body: { amountRupees: Number(amount) } });
      if (order.provider === 'mock') {
        await after(api('/wallet/topup/verify', { method: 'POST', body: { orderId: order.orderId } }), `${rupees(order.amountPaise)} added (test mode)`);
        return;
      }
      await loadRazorpay();
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: 'INR',
        name: 'Wallet top-up',
        prefill: { email: user.email, contact: user.phone ?? '' },
        theme: { color: '#ff4f79' },
        handler: (resp) =>
          after(
            api('/wallet/topup/verify', {
              method: 'POST',
              body: { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature },
            }),
            `${rupees(order.amountPaise)} added`,
          ),
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  if (!w || !meta) return <div className="page center">Loading…</div>;
  const packages = meta.packages.filter((p) => p.rateKey === tab);

  return (
    <div className="page stack">
      <h2>Wallet</h2>
      <div className="card balance">
        <div>
          <small className="muted">Balance</small>
          <div className="big">{rupees(w.walletPaise)}</div>
        </div>
        <div>
          <small className="muted">Coins</small>
          <div className="big">🪙 {w.coins}</div>
        </div>
      </div>
      <p className="fine">
        Package minutes: 👩 {w.packageMinutes.female ?? 0} · 👨 {w.packageMinutes.male ?? 0}. Earn 🪙 1 for every name you guess
        right in Discover. 🪙 {meta.sampleCall?.coins} = a {Math.round((meta.sampleCall?.seconds ?? 60) / 60) || 1}-minute sample call with
        anyone (coins are used only if they accept).
      </p>

      <section className="card stack">
        <h3>Add money</h3>
        <div className="chips">
          {[100, 200, 500, 1000, 2000].map((a) => (
            <button key={a} className={`chip ${Number(amount) === a ? 'on' : ''}`} onClick={() => setAmount(a)}>₹{a}</button>
          ))}
        </div>
        <div className="row">
          <input type="number" min={50} max={50000} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn" onClick={topup} disabled={busy}>Pay ₹{amount || 0}</button>
        </div>
        <p className="fine">UPI, cards & netbanking via Razorpay.{w.paymentsMode === 'mock' && ' Test mode: money is added instantly.'}</p>
      </section>

      <section className="card stack">
        <h3>Call packages</h3>
        <div className="tabs">
          <button className={tab === 'female' ? 'active' : ''} onClick={() => setTab('female')}>With women</button>
          <button className={tab === 'male' ? 'active' : ''} onClick={() => setTab('male')}>With men</button>
        </div>
        <p className="fine">
          Pay-as-you-go: {rupees(meta.rates[tab].pricePaise)} / {meta.rates[tab].minutes} min. Packages are paid from your wallet and valid 90 days.
        </p>
        <div className="packages">
          {packages.map((p) => (
            <div key={p.id} className="package">
              {p.discountPercent > 0 && <span className="save">Save {p.discountPercent}%</span>}
              <strong>{p.minutes} min</strong>
              <span className="muted small">{p.label}</span>
              <span>
                <b>{rupees(p.pricePaise)}</b> <s className="muted small">{rupees(p.paygPaise)}</s>
              </span>
              <button className="btn small" disabled={busy} onClick={() => after(api(`/packages/${p.id}/buy`, { method: 'POST' }), `${p.minutes} minutes added`)}>
                Buy
              </button>
            </div>
          ))}
        </div>
      </section>

      {(user.isHost || w.earningsPaise > 0) && (
        <section className="card stack">
          <h3>Friend earnings</h3>
          <div className="big">{rupees(w.earningsPaise)}</div>
          <p className="fine">You keep {100 - meta.platformFeePercent}% of every paid minute. Withdraw to UPI (min ₹100).</p>
          <div className="row">
            <input placeholder="Amount ₹" type="number" value={withdraw.amountRupees} onChange={(e) => setWithdraw({ ...withdraw, amountRupees: e.target.value })} />
            <input placeholder="UPI ID" value={withdraw.upiId} onChange={(e) => setWithdraw({ ...withdraw, upiId: e.target.value })} />
          </div>
          <button
            className="btn"
            disabled={busy}
            onClick={() => after(api('/wallet/withdraw', { method: 'POST', body: { ...withdraw, amountRupees: Number(withdraw.amountRupees) } }), 'Withdrawal requested')}
          >
            Withdraw
          </button>
          {w.withdrawals.map((x) => (
            <div key={x.id} className="row-between small">
              <span>{rupees(x.amountPaise)} → {x.upiId}</span>
              <span className={`status ${x.status}`}>{x.status}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card stack">
        <h3>Recent calls</h3>
        {calls.length === 0 && <p className="muted">No calls yet.</p>}
        {calls.map((c) => (
          <div key={c.id} className="row-between small">
            <span>
              {c.direction === 'outgoing' ? '↗' : '↙'} {c.media === 'video' ? '🎥' : '📞'} {displayName(c.other)} · {c.mode === 'sample' ? 'sample · ' : ''}{c.status}
              {c.minutes > 0 && ` · ${c.minutes} min`}
            </span>
            <span className={c.amountPaise < 0 ? 'neg' : c.amountPaise > 0 ? 'pos' : 'muted'}>
              {c.coinsSpent
                ? `−${c.coinsSpent} 🪙`
                : c.amountPaise
                  ? `${c.amountPaise > 0 ? '+' : '−'}${rupees(Math.abs(c.amountPaise))}`
                  : timeAgo(c.createdAt)}
            </span>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>Transactions</h3>
        {w.transactions.length === 0 && <p className="muted">Nothing yet.</p>}
        {w.transactions.map((t) => (
          <div key={t.id} className="row-between small">
            <span>
              {TX_LABEL[t.type] ?? t.type} <span className="muted">· {timeAgo(t.createdAt)}</span>
            </span>
            <span className={t.amountPaise < 0 ? 'neg' : 'pos'}>
              {txAmount(t)}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
