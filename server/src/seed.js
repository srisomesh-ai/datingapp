// Creates demo users (password: password123) with generated placeholder photos.
// Usage: npm run seed
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { CATALOG, UPLOAD_DIR } from './config.js';
import { one, run } from './db.js';
import { shuffle } from './util.js';
import { ledger } from './billing.js';

const SIZE = 600;

function avatar(seed) {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  const hue = (seed * 47) % 360;
  const toRgb = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  };
  const [r1, g1, b1] = toRgb(hue, 0.7, 0.55);
  const [r2, g2, b2] = toRgb((hue + 60) % 360, 0.7, 0.35);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = (x + y) / (2 * SIZE);
      // A simple "head and shoulders" silhouette as a portrait placeholder.
      const head = (x - 300) ** 2 + (y - 240) ** 2 < 110 ** 2;
      const body = (x - 300) ** 2 / 200 ** 2 + (y - 600) ** 2 / 190 ** 2 < 1;
      const i = (y * SIZE + x) * 4;
      const shade = head || body ? 0.92 : 0;
      data[i] = Math.round((r1 * (1 - t) + r2 * t) * (1 - shade) + 250 * shade);
      data[i + 1] = Math.round((g1 * (1 - t) + g2 * t) * (1 - shade) + 235 * shade);
      data[i + 2] = Math.round((b1 * (1 - t) + b2 * t) * (1 - shade) + 220 * shade);
      data[i + 3] = 255;
    }
  }
  return data;
}

const enc = (data, w, h) => jpeg.encode({ data, width: w, height: h }, 82).data;

const PEOPLE = [
  ['Ananya', 'female', 'Bengaluru', 'Chai over coffee, always.', 1],
  ['Rohan', 'male', 'Mumbai', 'Weekend trekker, weekday coder.', 1],
  ['Priya', 'female', 'Delhi', 'Looking for someone to share street food with.', 0],
  ['Arjun', 'male', 'Hyderabad', 'Cricket, biryani and bad puns.', 0],
  ['Sneha', 'female', 'Pune', 'Bookworm with a playlist for every mood.', 1],
  ['Vikram', 'male', 'Chennai', 'Ask me about my plants.', 1],
  ['Kavya', 'female', 'Kochi', 'Beach sunsets > everything.', 0],
  ['Aditya', 'male', 'Jaipur', 'Amateur photographer, professional foodie.', 0],
  ['Isha', 'female', 'Kolkata', 'Let\'s talk about anime and life.', 1],
  ['Karan', 'male', 'Ahmedabad', 'Gym in the morning, guitar at night.', 0],
];

const hash = bcrypt.hashSync('password123', 10);
let created = 0;
PEOPLE.forEach(([name, gender, city, bio, isHost], idx) => {
  const email = `${name.toLowerCase()}@demo.app`;
  if (one('SELECT 1 FROM users WHERE email = ?', email)) return;
  const { lastInsertRowid } = run(
    `INSERT INTO users (email, password_hash, name, gender, interested_in, looking_for, dob, city, bio, hobbies, likes,
       favorite_cuisine, weekend_style, chronotype, dream_destination, has_photo, photo_version, is_host, host_available, host_headline,
       wallet_paise)
     VALUES (?, ?, ?, ?, 'everyone', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, 50000)`,
    email,
    hash,
    name,
    gender,
    CATALOG.lookingFor[idx % 3],
    `${1994 + (idx % 8)}-0${1 + (idx % 9)}-1${idx % 9}`,
    city,
    bio,
    JSON.stringify(shuffle(CATALOG.hobbies).slice(0, 4)),
    JSON.stringify(shuffle(CATALOG.likes).slice(0, 4)),
    shuffle(CATALOG.cuisines)[0],
    shuffle(CATALOG.weekendStyles)[0],
    shuffle(CATALOG.chronotypes)[0],
    shuffle(CATALOG.destinations)[0],
    isHost,
    isHost,
    isHost ? 'Here to listen, laugh and chat 🙂' : '',
  );
  ledger(Number(lastInsertRowid), 'wallet', 'topup', 50000, { note: 'Demo credit' });
  const dir = path.join(UPLOAD_DIR, String(lastInsertRowid), 'v1');
  fs.mkdirSync(dir, { recursive: true });
  const img = avatar(idx + 1);
  fs.writeFileSync(path.join(dir, 'full.jpg'), enc(img, SIZE, SIZE));
  created++;
});
console.log(`Seeded ${created} demo users. Log in as e.g. ananya@demo.app / password123 (each has ₹500 in wallet).`);
