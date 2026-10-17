# Dating & Friends app (name TBD)

This is a web app for finding a soulmate or a friend, built mobile-first. It has two main features:

1. **Guess the name (instead of swiping).** Discover shows each person's photo and profile, but their **name is hidden** behind a hint (e.g. `R _ _ _ _`). Pick the right name from 4 options. It's a little challenging, not a giveaway: one look-alike name always fits the hint too (e.g. Rajan / Rohan), the other options look similar but don't fit, and at most about a third of the letters show. A careful guess is about 50/50.
   - **Right guess:** you earn **🪙 1 coin**, the other person is **notified** ("Tara guessed your name!"), and **a chat opens for both of you**.
   - **Wrong guess:** no chat. You can try that person again after 24 hours, and the answer isn't revealed.
   - **Chat is free up to a limit:** each person gets **10 free messages** per chat. After that, **₹49** (paid once, from the wallet) unlocks unlimited messages to that person.
   - **No free calls:** calling someone you're connected with costs **₹5/min** from the wallet (the platform keeps it), or **🪙 10 for a 1-minute call**. Coins are only used if they answer, at most once per person per day.
   - Daily limits stop people tapping through every photo: **20 guesses per day** and at most **10 coins per day** (`guessesPerDay`, `dailyCoinLimit`).
2. **Find a Friend (paid voice and video calls).** Users can turn on *Friend mode* and go "available". Anyone can then voice or video call them, paying per minute:

   | Friend    | Pay-as-you-go           | Packages (from wallet, valid 90 days)                  |
   |-----------|-------------------------|--------------------------------------------------------|
   | Male      | ₹100 / 10 min (₹10/min) | 30 min ₹270 (−10%), 60 min ₹480 (−20%), 120 min ₹840 (−30%) |
   | Female    | ₹100 / 5 min (₹20/min)  | 15 min ₹270 (−10%), 30 min ₹480 (−20%), 60 min ₹840 (−30%)  |

   The **platform fee is 25% of every paid minute**, and the friend keeps 75% as withdrawable earnings (paid out to UPI after admin approval). Package minutes are used first, then wallet balance. Billing is prepaid: each minute is charged as it starts, and the call ends automatically when the caller runs out.

## Features

- Email signup with an 18+ check, profiles with a hobbies/likes catalog and optional fun facts
- The answer never reaches the client before you guess: the server sends only the masked name and the options, and hides the name everywhere else (profile, chat and call lookups) until you're connected.
- Coins ledger shown in the top bar and Wallet: earned by guessing names, spent on 1-minute calls (`SAMPLE_CALL`). Chat limits and the per-minute call price are `CHAT` and `MATCH_CALL` in `server/src/config.js`.
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
npm test              # server tests: name guess, connections, chat limits, wallet, call billing & fee split
```

To try a call, open two browsers (or one normal window and one incognito window), log in as two different users, and call a friend who is "Available". Camera and mic access require `localhost` or HTTPS.

Without Razorpay keys, payments run in **mock mode**: "Pay" credits the wallet instantly.

## Go live (VPS)

Follow **[deploy/README.md](deploy/README.md)**. One command (`deploy/setup.sh`) installs and configures a fresh Ubuntu VPS:

- Node.js 22 and the app as a service
- HTTPS through Caddy, on a free `<ip>.sslip.io` address until you have a domain
- a TURN relay (coturn) so calls work on mobile data, with short-lived per-user credentials
- the firewall
- daily database backups

Before a public launch:

- **Single instance.** Call timers and presence live in memory, so run one server process. Scaling out would need a Socket.IO Redis adapter plus shared call state.
- **Payouts.** Withdrawals are marked paid manually by an admin. Automate them with RazorpayX if needed.
- **Compliance.** Paid companionship calls need clear content and safety policies, KYC for friends who earn, and GST/TDS treatment of the platform fee and payouts. Confirm with a CA or lawyer.

## Where to change things

- Prices, packages, the 25% fee, guess-the-name rules, decoy names, chat limits, call prices and the hobby/like catalogs are all in `server/src/config.js`. The client reads them from `/api/meta`.
- App name: `APP_NAME` in `client/src/lib/api.js`, plus `client/index.html` and `client/public/manifest.webmanifest`. It is currently the placeholder `AppName`.
