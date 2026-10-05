# Dating & Friends app (name TBD)

This is a web app for finding a soulmate or a friend, built mobile-first. It has two main features:

1. **Puzzle reveal (instead of swiping).** Every profile photo starts hidden behind a 3×3 grid. To uncover it, you answer questions about the person's hobbies, likes, favourite cuisine, perfect weekend and so on. Each right answer reveals 3 tiles. Get 3 right and the whole photo is revealed and **messaging unlocks**. Two wrong answers end the attempt, and you can try again after 24 hours. Tiles you already uncovered stay uncovered.
2. **Find a Friend (paid voice and video calls).** Users can turn on *Friend mode* and go "available". Anyone can then voice or video call them, paying per minute:

   | Friend    | Pay-as-you-go           | Packages (from wallet, valid 90 days)                  |
   |-----------|-------------------------|--------------------------------------------------------|
   | Male      | ₹100 / 10 min (₹10/min) | 30 min ₹270 (−10%), 60 min ₹480 (−20%), 120 min ₹840 (−30%) |
   | Female    | ₹100 / 5 min (₹20/min)  | 15 min ₹270 (−10%), 30 min ₹480 (−20%), 60 min ₹840 (−30%)  |

   The **platform fee is 25% of every paid minute**, and the friend keeps 75% as withdrawable earnings (paid out to UPI after admin approval). Package minutes are used first, then wallet balance. Billing is prepaid: each minute is charged as it starts, and the call ends automatically when the caller runs out.

People who are connected through a solved puzzle can also voice and video call each other **for free** from the chat.

## Features

- Email signup with an 18+ check, profiles with a hobbies/likes catalog and a quick-questions quiz
- Puzzle answers never reach the client. The server sends one question at a time and serves photo **tiles individually**, only after they are earned. The unrevealed photo is shown as a tiny 12px blurred preview.
- Realtime chat over Socket.IO, with unread counts and read receipts
- 1:1 WebRTC voice and video calls (mute, camera on/off, front/back camera switch, ringtone, live cost meter, low-balance warning, end-of-call summary)
- Wallet: top-ups through Razorpay (UPI, cards, netbanking), call packages, transaction ledger, friend earnings and UPI withdrawals
- Safety: block, report, admin ban
- Admin page: revenue and platform-fee stats, withdrawal approvals, reports
- Installable PWA (manifest)

## Tech

- `server/`: Node 22.13+, Express 5, Socket.IO, SQLite (built-in `node:sqlite`, so no native build step), JWT in an httpOnly cookie
- `client/`: React 19 + Vite, react-router, plain CSS
- Calls: WebRTC peer-to-peer. The server only relays signaling and does the billing.

## Run it locally

```bash
npm run install:all
npm run seed          # 10 demo users, e.g. ananya@demo.app / password123 (₹500 wallet each)
npm run dev:server    # API + sockets on :4000
npm run dev:client    # app on http://localhost:5173 (proxies /api and /socket.io)
npm test              # server tests: puzzle, messaging gate, wallet, paid-call billing & fee split
```

To try a call, open two browsers (or one normal window and one incognito window), log in as two different users, and call a friend who is "Available". Camera and mic access require `localhost` or HTTPS.

Without Razorpay keys, payments run in **mock mode**: "Pay" credits the wallet instantly.

## Static demo (for layout testing on plain HTML hosting)

`npm --prefix client run build:demo` builds `client/dist-demo/`. This is a version of the app that needs **no server**. A fake backend runs in the browser, with 10 demo people, auto-replies in chat, the real puzzle rules, a wallet and packages. Calls connect over real WebRTC to a local animated "demo video" peer, and the yellow bar's **Test incoming call** button rings you. In the demo, one billed minute lasts 10 seconds so you can watch the meter move. Data is kept in that browser's localStorage, and logging out resets it.

A ready-built copy is committed in **`demo-site/`**, so you can download it straight from GitHub. To use it, upload the *contents* of `demo-site/` (or `client/dist-demo/` after building) (including `.htaccess`, which makes deep links work on Apache/LiteSpeed) to your hosting's `public_html`. Camera and mic need HTTPS. The normal `npm run build` contains none of the demo code.

## Production

```bash
npm run build && NODE_ENV=production JWT_SECRET=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... npm start
```

The server serves the built client from `client/dist`. See `server/.env.example` for every setting. Before launch:

- **TURN server.** STUN alone fails for many users on mobile data or behind strict NATs. Run coturn or use a hosted TURN service, and set `ICE_SERVERS`.
- **HTTPS** is required for camera and mic access.
- **Single instance.** Call timers and presence live in memory, so run one server process. Scaling out would need a Socket.IO Redis adapter plus shared call state.
- **Payouts.** Withdrawals are marked paid manually by an admin. Automate them with RazorpayX if needed.
- **Compliance.** Paid companionship calls need clear content and safety policies, KYC for friends who earn, and GST/TDS treatment of the platform fee and payouts. Confirm with a CA or lawyer.

## Where to change things

- Prices, packages, the 25% fee, puzzle rules and the hobby/like catalogs are all in `server/src/config.js`. The client reads them from `/api/meta`.
- App name: `APP_NAME` in `client/src/lib/api.js`, plus `client/index.html` and `client/public/manifest.webmanifest`. It is currently the placeholder `AppName`.
