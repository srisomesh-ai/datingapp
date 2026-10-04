import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG, TILE_COUNT, UPLOAD_DIR } from '../config.js';
import { one, run } from '../db.js';
import { hasSolved, revealedTiles } from '../puzzle.js';
import { HttpError, publicView, requireAuth, requireOneOf, requireString, selfView } from '../util.js';

const router = Router();
router.use(requireAuth);

router.get('/profile', (req, res) => res.json({ user: selfView(req.user) }));

function listFrom(value, catalog, field, { min, max }) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be a list`);
  const items = [...new Set(value)];
  if (items.some((v) => !catalog.includes(v))) throw new HttpError(400, `Unknown ${field} option`);
  if (items.length < min || items.length > max) throw new HttpError(400, `Pick ${min}-${max} ${field}`);
  return JSON.stringify(items);
}

router.put('/profile', (req, res) => {
  const b = req.body ?? {};
  const updates = {};
  if (b.name !== undefined) updates.name = requireString(b.name, 'Name', { max: 40 });
  if (b.bio !== undefined) updates.bio = requireString(b.bio, 'Bio', { min: 0, max: 500 });
  if (b.city !== undefined) updates.city = requireString(b.city, 'City', { min: 0, max: 60 });
  if (b.interestedIn !== undefined) updates.interested_in = requireOneOf(b.interestedIn, CATALOG.interestedIn, 'interest');
  if (b.lookingFor !== undefined) updates.looking_for = requireOneOf(b.lookingFor, CATALOG.lookingFor, 'looking for');
  if (b.hobbies !== undefined) updates.hobbies = listFrom(b.hobbies, CATALOG.hobbies, 'hobbies', { min: 3, max: 8 });
  if (b.likes !== undefined) updates.likes = listFrom(b.likes, CATALOG.likes, 'likes', { min: 3, max: 8 });
  if (b.favoriteCuisine !== undefined) updates.favorite_cuisine = requireOneOf(b.favoriteCuisine, CATALOG.cuisines, 'cuisine');
  if (b.weekendStyle !== undefined) updates.weekend_style = requireOneOf(b.weekendStyle, CATALOG.weekendStyles, 'weekend style');
  if (b.chronotype !== undefined) updates.chronotype = requireOneOf(b.chronotype, CATALOG.chronotypes, 'chronotype');
  if (b.dreamDestination !== undefined) updates.dream_destination = requireOneOf(b.dreamDestination, CATALOG.destinations, 'destination');

  const cols = Object.keys(updates);
  if (cols.length) {
    run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(updates), req.user.id);
  }
  res.json({ user: selfView(one('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// ---- Photo upload: the client sends the square photo, a tiny blurred preview
// and the 3x3 tiles. Tiles are served individually so a locked photo never leaks.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: TILE_COUNT + 2 } });
const photoFields = [
  { name: 'full', maxCount: 1 },
  { name: 'blur', maxCount: 1 },
  ...Array.from({ length: TILE_COUNT }, (_, i) => ({ name: `tile${i}`, maxCount: 1 })),
];
const isJpeg = (buf) => buf?.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

router.post('/profile/photo', upload.fields(photoFields), (req, res) => {
  const files = req.files ?? {};
  const names = photoFields.map((f) => f.name);
  for (const n of names) {
    if (!isJpeg(files[n]?.[0]?.buffer)) throw new HttpError(400, `Missing or invalid image part: ${n}`);
  }
  if (files.blur[0].size > 20 * 1024) throw new HttpError(400, 'Blur preview too large');

  const version = req.user.photo_version + 1;
  const dir = path.join(UPLOAD_DIR, String(req.user.id), `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, `${n}.jpg`), files[n][0].buffer);
  // Drop the previous version.
  fs.rmSync(path.join(UPLOAD_DIR, String(req.user.id), `v${req.user.photo_version}`), { recursive: true, force: true });

  run('UPDATE users SET has_photo = 1, photo_version = ? WHERE id = ?', version, req.user.id);
  res.json({ user: selfView(one('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

function sendPhotoPart(res, user, part) {
  const file = path.join(UPLOAD_DIR, String(user.id), `v${user.photo_version}`, `${part}.jpg`);
  if (!user.has_photo || !fs.existsSync(file)) throw new HttpError(404, 'No photo');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
}

function targetUser(id) {
  const u = one('SELECT * FROM users WHERE id = ? AND is_banned = 0', Number(id));
  if (!u) throw new HttpError(404, 'User not found');
  return u;
}

/** Full photo is visible to: yourself, people who solved your puzzle, and callers if you're a listed friend. */
export function canSeeFullPhoto(viewerId, target) {
  return viewerId === target.id || Boolean(target.is_host) || hasSolved(viewerId, target.id);
}

router.get('/photos/:id/blur', (req, res) => sendPhotoPart(res, targetUser(req.params.id), 'blur'));

router.get('/photos/:id/full', (req, res) => {
  const target = targetUser(req.params.id);
  if (!canSeeFullPhoto(req.user.id, target)) throw new HttpError(403, 'Solve the puzzle to see this photo');
  sendPhotoPart(res, target, 'full');
});

router.get('/photos/:id/tile/:n', (req, res) => {
  const target = targetUser(req.params.id);
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 0 || n >= TILE_COUNT) throw new HttpError(400, 'Invalid tile');
  if (!canSeeFullPhoto(req.user.id, target) && !revealedTiles(req.user.id, target.id).includes(n)) {
    throw new HttpError(403, 'Tile not revealed yet');
  }
  sendPhotoPart(res, target, `tile${n}`);
});

router.get('/users/:id', (req, res) => {
  const target = targetUser(req.params.id);
  const revealed = req.user.id === target.id || hasSolved(req.user.id, target.id);
  res.json({
    user: publicView(target, { revealed }),
    canSeePhoto: canSeeFullPhoto(req.user.id, target),
    revealedTiles: revealedTiles(req.user.id, target.id),
  });
});

router.post('/users/:id/block', (req, res) => {
  const target = targetUser(req.params.id);
  if (target.id === req.user.id) throw new HttpError(400, 'You cannot block yourself');
  run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', req.user.id, target.id);
  res.json({ ok: true });
});

router.delete('/users/:id/block', (req, res) => {
  run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

router.post('/users/:id/report', (req, res) => {
  const target = targetUser(req.params.id);
  const reason = requireString(req.body?.reason, 'Reason', { max: 500 });
  run('INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?, ?, ?)', req.user.id, target.id, reason);
  res.status(201).json({ ok: true });
});

export default router;
