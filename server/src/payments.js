// Wallet top-ups via Razorpay (UPI, cards, netbanking). Without keys, a mock
// provider credits instantly so the app can be developed end-to-end.
import crypto from 'node:crypto';
import { PAYMENTS_MODE, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, TOPUP_MAX_PAISE, TOPUP_MIN_PAISE } from './config.js';
import { one, run, tx } from './db.js';
import { creditWallet } from './billing.js';
import { HttpError } from './util.js';

export async function createTopupOrder(userId, amountPaise) {
  if (!Number.isInteger(amountPaise) || amountPaise < TOPUP_MIN_PAISE || amountPaise > TOPUP_MAX_PAISE) {
    throw new HttpError(400, `Top-up must be between ₹${TOPUP_MIN_PAISE / 100} and ₹${TOPUP_MAX_PAISE / 100}`);
  }
  let orderId;
  if (PAYMENTS_MODE === 'razorpay') {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
      },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: `topup_${userId}_${Date.now()}` }),
    });
    if (!res.ok) throw new HttpError(502, 'Payment provider error, please try again');
    orderId = (await res.json()).id;
  } else {
    orderId = `mock_order_${crypto.randomUUID()}`;
  }
  run('INSERT INTO payments (user_id, provider, order_id, amount_paise) VALUES (?, ?, ?, ?)', userId, PAYMENTS_MODE, orderId, amountPaise);
  return { provider: PAYMENTS_MODE, orderId, amountPaise, currency: 'INR', keyId: RAZORPAY_KEY_ID || null };
}

export function verifyRazorpaySignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Idempotent: verifying the same order twice credits the wallet once. */
export function confirmTopup(userId, { orderId, paymentId, signature }) {
  return tx(() => {
    const payment = one('SELECT * FROM payments WHERE order_id = ? AND user_id = ?', orderId, userId);
    if (!payment) throw new HttpError(404, 'Order not found');
    if (payment.status === 'paid') return payment;
    if (payment.provider === 'razorpay' && !verifyRazorpaySignature(orderId, paymentId, signature)) {
      throw new HttpError(400, 'Payment verification failed');
    }
    run(
      "UPDATE payments SET status = 'paid', provider_payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      paymentId ?? null,
      payment.id,
    );
    creditWallet(userId, payment.amount_paise, 'topup', { refType: 'payment', refId: payment.id });
    return one('SELECT * FROM payments WHERE id = ?', payment.id);
  });
}
