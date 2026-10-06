import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG, UPLOAD_DIR } from '../config.js';
import { one, run } from '../db.js';
import { getGuess, isMatched, nameKnown } from '../connections.js';
import { HttpError, isBlockedEitherWay, publicView, requireAuth, requireOneOf, requireString, selfView } from '../util.js';

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
  // Optional extras: null/empty clears them.
  const optional = (v, options, field) => (v == null || v === '' ? null : requireOneOf(v, options, field));
  if (b.favoriteCuisine !== undefined) updates.favorite_cuisine = optional(b.favoriteCuisine, CATALOG.cuisines, 'cuisine');
  if (b.weekendStyle !== undefined) updates.weekend_style = optional(b.weekendStyle, CATALOG.weekendStyles, 'weekend style');
  if (b.chronotype !== undefined) updates.chronotype = optional(b.chronotype, CATALOG.chronotypes, 'chronotype');
  if (b.dreamDestination !== undefined) updates.dream_destination = optional(b.dreamDestination, CATALOG.destinations, 'destination');

  const cols = Object.keys(updates);
  if (cols.length) {
    run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(updates), req.user.id);
  }
  res.json({ user: selfView(one('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// ---- Profile photo (the client crops/resizes it to a square JPEG). Photos are
// visible to every logged-in user; only the name is part of the guessing game.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
const isJpeg = (buf) => buf?.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

router.post('/profile/photo', upload.single('full'), (req, res) => {
  if (!isJpeg(req.file?.buffer)) throw new HttpError(400, 'Please upload a JPEG photo');
  const version = req.user.photo_version + 1;
  const dir = path.join(UPLOAD_DIR, String(req.user.id), `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'full.jpg'), req.file.buffer);
  // Drop the previous version.
  fs.rmSync(path.join(UPLOAD_DIR, String(req.user.id), `v${req.user.photo_version}`), { recursive: true, force: true });

  run('UPDATE users SET has_photo = 1, photo_version = ? WHERE id = ?', version, req.user.id);
  res.json({ user: selfView(one('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

function targetUser(id) {
  const u = one('SELECT * FROM users WHERE id = ? AND is_banned = 0', Number(id));
  if (!u) throw new HttpError(404, 'User not found');
  return u;
}

router.get('/photos/:id/full', (req, res) => {
  const target = targetUser(req.params.id);
  if (target.id !== req.user.id && isBlockedEitherWay(req.user.id, target.id)) throw new HttpError(404, 'No photo');
  const file = path.join(UPLOAD_DIR, String(target.id), `v${target.photo_version}`, 'full.jpg');
  if (!target.has_photo || !fs.existsSync(file)) throw new HttpError(404, 'No photo');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

router.get('/users/:id', (req, res) => {
  const target = targetUser(req.params.id);
  const known = nameKnown(req.user.id, target);
  const g = known ? null : getGuess(req.user.id, target.id);
  res.json({
    user: publicView(target, { hideName: !known, mask: g?.mask ?? null }),
    matched: isMatched(req.user.id, target.id),
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
