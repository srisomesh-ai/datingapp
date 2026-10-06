import crypto from 'node:crypto';
import { ICE_SERVERS, TURN_SECRET, TURN_TTL_SECONDS, TURN_URLS } from './config.js';

/**
 * STUN servers plus, when configured, time-limited TURN credentials in the format
 * coturn's `use-auth-secret` expects: username "<expiry>:<userId>", password
 * base64(HMAC-SHA1(secret, username)).
 */
export function iceServersFor(userId) {
  if (!TURN_SECRET || !TURN_URLS.length) return ICE_SERVERS;
  const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS}:${userId}`;
  const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  return [...ICE_SERVERS, { urls: TURN_URLS, username, credential }];
}
