import jwt from 'jsonwebtoken';
import { JWT_SECRET, IS_PROD, PROFILE_MIN, perMinutePaise, PAYG_RATES, rateKeyFor } from './config.js';
import { one } from './db.js';
import { parseList, shuffle } from './puzzleQuestions.js';

export { parseList, shuffle };

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const COOKIE = 'token';
const TOKEN_TTL_DAYS = 30;

export function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: `${TOKEN_TTL_DAYS}d` });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: TOKEN_TTL_DAYS * 24 * 3600 * 1000,
  });
}

/** Resolve a user from a raw JWT; returns null if invalid, missing or banned. */
export function userFromToken(token) {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const user = one('SELECT * FROM users WHERE id = ?', sub);
    if (!user || user.is_banned) return null;
    return user;
  } catch {
    return null;
  }
}

export function tokenFromReq(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[COOKIE];
}

export function requireAuth(req, _res, next) {
  const user = userFromToken(tokenFromReq(req));
  if (!user) return next(new HttpError(401, 'Please log in'));
  req.user = user;
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user?.is_admin) return next(new HttpError(403, 'Admins only'));
  next();
}

export function ageFromDob(dob) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}


export function isProfileComplete(u) {
  return Boolean(
    u.has_photo &&
      parseList(u.hobbies).length >= PROFILE_MIN.hobbies &&
      parseList(u.likes).length >= PROFILE_MIN.likes &&
      u.favorite_cuisine &&
      u.weekend_style &&
      u.chronotype &&
      u.dream_destination,
  );
}

/** Everything about the logged-in user (never send this for other users). */
export function selfView(u) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    name: u.name,
    gender: u.gender,
    interestedIn: u.interested_in,
    lookingFor: u.looking_for,
    dob: u.dob,
    age: ageFromDob(u.dob),
    city: u.city,
    bio: u.bio,
    hobbies: parseList(u.hobbies),
    likes: parseList(u.likes),
    favoriteCuisine: u.favorite_cuisine,
    weekendStyle: u.weekend_style,
    chronotype: u.chronotype,
    dreamDestination: u.dream_destination,
    hasPhoto: Boolean(u.has_photo),
    photoVersion: u.photo_version,
    isHost: Boolean(u.is_host),
    hostAvailable: Boolean(u.host_available),
    hostHeadline: u.host_headline,
    walletPaise: u.wallet_paise,
    earningsPaise: u.earnings_paise,
    isAdmin: Boolean(u.is_admin),
    profileComplete: isProfileComplete(u),
  };
}

/**
 * What another user may see. Puzzle answers (hobbies, likes, quiz fields) are
 * deliberately excluded unless the viewer already solved the puzzle.
 */
export function publicView(u, { revealed = false } = {}) {
  const base = {
    id: u.id,
    name: u.name,
    gender: u.gender,
    age: ageFromDob(u.dob),
    city: u.city,
    bio: u.bio,
    lookingFor: u.looking_for,
    hasPhoto: Boolean(u.has_photo),
    photoVersion: u.photo_version,
    revealed,
  };
  if (!revealed) return base;
  return {
    ...base,
    hobbies: parseList(u.hobbies),
    likes: parseList(u.likes),
    favoriteCuisine: u.favorite_cuisine,
    weekendStyle: u.weekend_style,
    chronotype: u.chronotype,
    dreamDestination: u.dream_destination,
  };
}

export function hostRate(gender) {
  const key = rateKeyFor(gender);
  return { rateKey: key, ...PAYG_RATES[key], paisePerMinute: perMinutePaise(gender) };
}

export function isBlockedEitherWay(a, b) {
  return Boolean(
    one('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a),
  );
}


export function requireString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} is required`);
  const v = value.trim();
  if (v.length < min || v.length > max) throw new HttpError(400, `${field} must be ${min}-${max} characters`);
  return v;
}

export function requireOneOf(value, options, field) {
  if (!options.includes(value)) throw new HttpError(400, `Invalid ${field}`);
  return value;
}
