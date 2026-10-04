// Wallet, packages and per-minute call billing. Every money movement is
// written to the transactions ledger inside the same DB transaction.
import { PACKAGES, PACKAGE_VALIDITY_DAYS, PLATFORM_FEE_PERCENT } from './config.js';
import { all, one, run, tx } from './db.js';
import { HttpError } from './util.js';

export function ledger(userId, account, type, amountPaise, { refType = null, refId = null, note = null } = {}) {
  run(
    'INSERT INTO transactions (user_id, account, type, amount_paise, ref_type, ref_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    account,
    type,
    amountPaise,
    refType,
    refId,
    note,
  );
}

/** Split a gross amount into platform fee and host share (fee rounded half-up, in paise). */
export function splitFee(grossPaise) {
  const fee = Math.round((grossPaise * PLATFORM_FEE_PERCENT) / 100);
  return { fee, hostShare: grossPaise - fee };
}

export function creditWallet(userId, amountPaise, type, refs) {
  run('UPDATE users SET wallet_paise = wallet_paise + ? WHERE id = ?', amountPaise, userId);
  ledger(userId, 'wallet', type, amountPaise, refs);
}

export function activeLots(userId, rateKey) {
  return all(
    `SELECT * FROM credit_lots WHERE user_id = ? AND rate_key = ? AND minutes_left > 0 AND expires_at > datetime('now')
     ORDER BY expires_at, id`,
    userId,
    rateKey,
  );
}

export function packageMinutes(userId) {
  const rows = all(
    `SELECT rate_key, SUM(minutes_left) AS minutes FROM credit_lots
     WHERE user_id = ? AND minutes_left > 0 AND expires_at > datetime('now') GROUP BY rate_key`,
    userId,
  );
  return Object.fromEntries(rows.map((r) => [r.rate_key, r.minutes]));
}

/** How many more minutes the caller can afford with a host of this rate. */
export function affordableMinutes(userId, rateKey, paisePerMinute) {
  const user = one('SELECT wallet_paise FROM users WHERE id = ?', userId);
  const pkg = packageMinutes(userId)[rateKey] ?? 0;
  return pkg + Math.floor((user?.wallet_paise ?? 0) / paisePerMinute);
}

export function buyPackage(userId, packageId) {
  const pkg = PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new HttpError(404, 'Package not found');
  return tx(() => {
    const user = one('SELECT wallet_paise FROM users WHERE id = ?', userId);
    if (user.wallet_paise < pkg.pricePaise) {
      throw new HttpError(402, 'Not enough wallet balance. Please add money first.');
    }
    run('UPDATE users SET wallet_paise = wallet_paise - ? WHERE id = ?', pkg.pricePaise, userId);
    const { lastInsertRowid } = run(
      `INSERT INTO credit_lots (user_id, package_id, rate_key, minutes_total, minutes_left, paise_per_minute, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`,
      userId,
      pkg.id,
      pkg.rateKey,
      pkg.minutes,
      pkg.minutes,
      pkg.paisePerMinute,
      `+${PACKAGE_VALIDITY_DAYS} days`,
    );
    ledger(userId, 'wallet', 'package_purchase', -pkg.pricePaise, {
      refType: 'credit_lot',
      refId: Number(lastInsertRowid),
      note: `${pkg.minutes} min ${pkg.rateKey} package`,
    });
    return one('SELECT * FROM credit_lots WHERE id = ?', lastInsertRowid);
  });
}

/**
 * Bill one minute of an active paid call (prepaid: called at the start of each minute).
 * Package minutes are used first, then wallet balance. 25% goes to the platform,
 * the rest to the friend's withdrawable earnings.
 * @returns {{ok: boolean, minutesLeft?: number, call?: object}}
 */
export function chargeMinute(callId) {
  return tx(() => {
    const call = one("SELECT * FROM calls WHERE id = ? AND status = 'active' AND mode = 'paid'", callId);
    if (!call) return { ok: false, reason: 'not_active' };

    let gross;
    let source;
    const lot = activeLots(call.caller_id, call.rate_key)[0];
    if (lot) {
      run('UPDATE credit_lots SET minutes_left = minutes_left - 1 WHERE id = ?', lot.id);
      gross = lot.paise_per_minute;
      source = 'package';
      ledger(call.caller_id, 'package', 'call_minute', -1, { refType: 'call', refId: call.id, note: '1 package minute' });
    } else {
      const caller = one('SELECT wallet_paise FROM users WHERE id = ?', call.caller_id);
      if (caller.wallet_paise < call.rate_paise_per_min) return { ok: false, reason: 'insufficient_balance' };
      gross = call.rate_paise_per_min;
      source = 'wallet';
      run('UPDATE users SET wallet_paise = wallet_paise - ? WHERE id = ?', gross, call.caller_id);
      ledger(call.caller_id, 'wallet', 'call_charge', -gross, { refType: 'call', refId: call.id });
    }

    const { fee, hostShare } = splitFee(gross);
    run('UPDATE users SET earnings_paise = earnings_paise + ? WHERE id = ?', hostShare, call.callee_id);
    ledger(call.callee_id, 'earnings', 'call_earning', hostShare, { refType: 'call', refId: call.id });
    ledger(null, 'platform', 'platform_fee', fee, { refType: 'call', refId: call.id, note: `${PLATFORM_FEE_PERCENT}% of ${gross}` });

    run(
      `UPDATE calls SET billed_minutes = billed_minutes + 1, caller_paid_paise = caller_paid_paise + ?,
       host_earned_paise = host_earned_paise + ?, platform_fee_paise = platform_fee_paise + ? WHERE id = ?`,
      gross,
      hostShare,
      fee,
      call.id,
    );
    return {
      ok: true,
      source,
      minutesLeft: affordableMinutes(call.caller_id, call.rate_key, call.rate_paise_per_min),
      call: one('SELECT * FROM calls WHERE id = ?', call.id),
    };
  });
}

export function requestWithdrawal(userId, amountPaise, upiId) {
  return tx(() => {
    const user = one('SELECT earnings_paise FROM users WHERE id = ?', userId);
    if (user.earnings_paise < amountPaise) throw new HttpError(402, 'Amount exceeds your earnings');
    run('UPDATE users SET earnings_paise = earnings_paise - ? WHERE id = ?', amountPaise, userId);
    const { lastInsertRowid } = run(
      'INSERT INTO withdrawals (user_id, amount_paise, upi_id) VALUES (?, ?, ?)',
      userId,
      amountPaise,
      upiId,
    );
    ledger(userId, 'earnings', 'withdrawal', -amountPaise, { refType: 'withdrawal', refId: Number(lastInsertRowid) });
    return one('SELECT * FROM withdrawals WHERE id = ?', lastInsertRowid);
  });
}

export function processWithdrawal(id, action) {
  return tx(() => {
    const w = one("SELECT * FROM withdrawals WHERE id = ? AND status = 'pending'", id);
    if (!w) throw new HttpError(404, 'Pending withdrawal not found');
    if (action === 'rejected') {
      run('UPDATE users SET earnings_paise = earnings_paise + ? WHERE id = ?', w.amount_paise, w.user_id);
      ledger(w.user_id, 'earnings', 'withdrawal_reversed', w.amount_paise, { refType: 'withdrawal', refId: w.id });
    }
    run("UPDATE withdrawals SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?", action, id);
    return one('SELECT * FROM withdrawals WHERE id = ?', id);
  });
}
