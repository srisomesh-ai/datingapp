// Selfie verification: the app asks for a random pose, takes a live selfie, and an
// admin compares it with the profile photo. Verified people get a blue tick.
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, VERIFICATION } from '../config.js';
import { one, run } from '../db.js';
import { HttpError, requireAuth, selfView } from '../util.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
const isJpeg = (buf) => buf?.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
const poseById = (id) => VERIFICATION.poses.find((p) => p.id === id) ?? null;

export const selfiePath = (userId, requestId) => path.join(UPLOAD_DIR, String(userId), `selfie-${requestId}.jpg`);

router.get('/verification', (req, res) => {
  const u = req.user;
  res.json({ status: u.verification_status, note: u.verification_note, pose: poseById(u.verification_pose) });
});

// Step 1: get a random pose to copy in the selfie (a new one each time).
router.post('/verification/pose', (req, res) => {
  const u = req.user;
  if (!u.has_photo) throw new HttpError(412, 'Add a profile photo first');
  if (u.verification_status === 'verified') throw new HttpError(409, 'You are already verified');
  if (u.verification_status === 'pending') throw new HttpError(409, 'Your selfie is being reviewed');
  const choices = VERIFICATION.poses.filter((p) => p.id !== u.verification_pose);
  const pose = choices[Math.floor(Math.random() * choices.length)];
  run('UPDATE users SET verification_pose = ? WHERE id = ?', pose.id, u.id);
  res.json({ pose });
});

// Step 2: send the live selfie doing that pose; it goes to the admin review queue.
router.post('/verification', upload.single('selfie'), (req, res) => {
  const u = req.user;
  if (!u.verification_pose) throw new HttpError(409, 'Start verification first');
  if (u.verification_status === 'verified' || u.verification_status === 'pending') throw new HttpError(409, 'Already submitted');
  if (!isJpeg(req.file?.buffer)) throw new HttpError(400, 'Please take a selfie with the camera');
  const { lastInsertRowid } = run(
    'INSERT INTO verification_requests (user_id, pose, photo_version) VALUES (?, ?, ?)',
    u.id,
    u.verification_pose,
    u.photo_version,
  );
  fs.mkdirSync(path.dirname(selfiePath(u.id, lastInsertRowid)), { recursive: true });
  fs.writeFileSync(selfiePath(u.id, lastInsertRowid), req.file.buffer);
  run("UPDATE users SET verification_status = 'pending', verification_note = NULL, verification_pose = NULL WHERE id = ?", u.id);
  res.status(201).json({ user: selfView(one('SELECT * FROM users WHERE id = ?', u.id)) });
});

export default router;
