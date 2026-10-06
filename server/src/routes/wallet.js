import { Router } from 'express';
import { PACKAGES, PAYMENTS_MODE, WITHDRAW_MIN_PAISE } from '../config.js';
import { all, one } from '../db.js';
import { buyPackage, packageMinutes, requestWithdrawal } from '../billing.js';
import { confirmTopup, createTopupOrder } from '../payments.js';
import { HttpError, requireAuth, requireString } from '../util.js';

const router = Router();
router.use(requireAuth);

function walletSummary(userId) {
  const u = one('SELECT wallet_paise, earnings_paise, coins FROM users WHERE id = ?', userId);
  return {
    walletPaise: u.wallet_paise,
    earningsPaise: u.earnings_paise,
    coins: u.coins,
    packageMinutes: packageMinutes(userId),
    lots: all(
      `SELECT id, package_id AS packageId, rate_key AS rateKey, minutes_total AS minutesTotal, minutes_left AS minutesLeft, expires_at AS expiresAt
       FROM credit_lots WHERE user_id = ? AND minutes_left > 0 AND expires_at > datetime('now') ORDER BY expires_at`,
      userId,
    ),
    paymentsMode: PAYMENTS_MODE,
  };
}

router.get('/wallet', (req, res) => {
  res.json({
    ...walletSummary(req.user.id),
    transactions: all(
      `SELECT id, account, type, amount_paise AS amountPaise, ref_type AS refType, ref_id AS refId, note, created_at AS createdAt
       FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
      req.user.id,
    ),
    withdrawals: all(
      'SELECT id, amount_paise AS amountPaise, upi_id AS upiId, status, created_at AS createdAt FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 20',
      req.user.id,
    ),
  });
});

router.get('/packages', (_req, res) => res.json({ packages: PACKAGES }));

router.post('/wallet/topup/order', async (req, res) => {
  const rupees = Number(req.body?.amountRupees);
  res.json(await createTopupOrder(req.user.id, Math.round(rupees * 100)));
});

router.post('/wallet/topup/verify', (req, res) => {
  const { orderId, paymentId, signature } = req.body ?? {};
  confirmTopup(req.user.id, { orderId: requireString(orderId, 'orderId'), paymentId, signature });
  res.json(walletSummary(req.user.id));
});

router.post('/packages/:id/buy', (req, res) => {
  buyPackage(req.user.id, req.params.id);
  res.json(walletSummary(req.user.id));
});

router.post('/wallet/withdraw', (req, res) => {
  const amountPaise = Math.round(Number(req.body?.amountRupees) * 100);
  if (!Number.isInteger(amountPaise) || amountPaise < WITHDRAW_MIN_PAISE) {
    throw new HttpError(400, `Minimum withdrawal is ₹${WITHDRAW_MIN_PAISE / 100}`);
  }
  const upiId = requireString(req.body?.upiId, 'UPI ID', { max: 100 });
  if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) throw new HttpError(400, 'Enter a valid UPI ID (e.g. name@bank)');
  requestWithdrawal(req.user.id, amountPaise, upiId);
  res.status(201).json(walletSummary(req.user.id));
});

export default router;
