# Dating & Friends app (name TBD)

This is a web app for finding a soulmate or a friend, built mobile-first. It has two main features:

1. **Guess the name (instead of swiping).** Discover shows each person's photo and profile, but their **name is hidden**, with only some letters showing (e.g. `R _ _ _ n`). Pick the right name from 4 options, with one try per profile:
   - **Right:** you earn **🪙 1 coin** and can send **one message** together with your ❤️ like.
   - **Wrong:** no coin and no message, but you can still send a plain like.
   - The other person sees your like and message under **Likes you** and can like back or pass. Liking each other is a **match**, which opens full chat and free calls.
   - Decoy names have the same gender and prefer the same first letter, so the visible letters are the clue. Coins are capped per day (`dailyCoinLimit`) to stop farming.
2. **Find a Friend (paid voice and video calls).** Users can turn on *Friend mode* and go "available". Anyone can then voice or video call them, paying per minute:

   | Friend    | Pay-as-you-go           | Packages (from wallet, valid 90 days)                  |
   |-----------|-------------------------|--------------------------------------------------------|
   | Male      | ₹100 / 10 min (₹10/min) | 30 min ₹270 (−10%), 60 min ₹480 (−20%), 120 min ₹840 (−30%) |
   | Female    | ₹100 / 5 min (₹20/min)  | 15 min ₹270 (−10%), 30 min ₹480 (−20%), 60 min ₹840 (−30%)  |

   The **platform fee is 25% of every paid minute**, and the friend keeps 75% as withdrawable earnings (paid out to UPI after admin approval). Package minutes are used first, then wallet balance. Billing is prepaid: each minute is charged as it starts, and the call ends automatically when the caller runs out.

Matches can also voice and video call each other **for free** from the chat.

## Features

- Email signup with an 18+ check, profiles with a hobbies/likes catalog and optional fun facts
- The answer never reaches the client before you guess: the server sends only the masked name and the options, and hides the name everywhere else (profile and chat lookups) until you've guessed or they've liked you.
- Coins ledger (shown in the top bar and Wallet). What coins can be spent on is still to be decided.
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
npm test              # server tests: name guess, likes/matches, wallet, paid-call billing & fee split
```

To try a call, open two browsers (or one normal window and one incognito window), log in as two different users, and call a friend who is "Available". Camera and mic access require `localhost` or HTTPS.

Without Razorpay keys, payments run in **mock mode**: "Pay" credits the wallet instantly.

## Static demo (for layout testing on plain HTML hosting)

`npm --prefix client run build:demo` builds `client/dist-demo/`. This is a version of the app that needs **no server**. A fake backend runs in the browser, with 10 demo people, auto-replies in chat, the real guess-the-name rules, people who like you back, a wallet and packages. Calls connect over real WebRTC to a local animated "demo video" peer, and the yellow bar's **Test incoming call** button rings you. In the demo, one billed minute lasts 10 seconds so you can watch the meter move. Data is kept in that browser's localStorage, and logging out resets it.

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

- Prices, packages, the 25% fee, guess-the-name rules, decoy names and the hobby/like catalogs are all in `server/src/config.js`. The client reads them from `/api/meta`.
- App name: `APP_NAME` in `client/src/lib/api.js`, plus `client/index.html` and `client/public/manifest.webmanifest`. It is currently the placeholder `AppName`.
