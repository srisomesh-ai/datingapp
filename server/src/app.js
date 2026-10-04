import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { CATALOG, ICE_SERVERS, PACKAGES, PAYG_RATES, PAYMENTS_MODE, PLATFORM_FEE_PERCENT, PROFILE_MIN, PUZZLE, RAZORPAY_KEY_ID } from './config.js';
import { run } from './db.js';
import { HttpError, userFromToken, COOKIE } from './util.js';
import { addSocket, removeSocket, setIo } from './realtime/hub.js';
import { registerCallHandlers } from './realtime/calls.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import discoverRoutes from './routes/discover.js';
import messageRoutes from './routes/messages.js';
import friendRoutes from './routes/friends.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';

const CLIENT_DIST = new URL('../../client/dist', import.meta.url).pathname;

export function createServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/meta', (_req, res) =>
    res.json({
      catalog: CATALOG,
      profileMin: PROFILE_MIN,
      puzzle: PUZZLE,
      rates: PAYG_RATES,
      packages: PACKAGES,
      platformFeePercent: PLATFORM_FEE_PERCENT,
      payments: { mode: PAYMENTS_MODE, razorpayKeyId: RAZORPAY_KEY_ID || null },
      iceServers: ICE_SERVERS,
    }),
  );

  app.use('/api/auth', authRoutes);
  app.use('/api', profileRoutes);
  app.use('/api', discoverRoutes);
  app.use('/api', messageRoutes);
  app.use('/api', friendRoutes);
  app.use('/api', walletRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Serve the built web app in production.
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') err = new HttpError(413, 'File too large');
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message, ...(err.extra ?? {}) });
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: false } });
  setIo(io);

  io.use((socket, next) => {
    const cookies = Object.fromEntries(
      (socket.handshake.headers.cookie ?? '')
        .split(';')
        .map((c) => c.trim().split('='))
        .filter(([k]) => k)
        .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
    );
    const user = userFromToken(socket.handshake.auth?.token ?? cookies[COOKIE]);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.join(`user:${userId}`);
    addSocket(userId, socket.id);
    run('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', userId);
    registerCallHandlers(io, socket);
    socket.on('disconnect', () => {
      if (removeSocket(userId, socket.id)) run('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', userId);
    });
  });

  return { app, server, io };
}
