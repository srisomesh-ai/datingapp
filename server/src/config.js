// Central configuration: money, pricing, guess-the-name rules and profile catalogs.
// All money is stored and computed in paise (1 INR = 100 paise) to avoid float errors.

const env = process.env;

export const PORT = Number(env.PORT ?? 4000);
export const IS_PROD = env.NODE_ENV === 'production';
export const JWT_SECRET = env.JWT_SECRET ?? 'dev-only-secret-change-me';
export const DB_FILE = env.DB_FILE ?? new URL('../data/app.db', import.meta.url).pathname;
export const UPLOAD_DIR = env.UPLOAD_DIR ?? new URL('../uploads', import.meta.url).pathname;
export const ADMIN_EMAILS = (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

if (IS_PROD && JWT_SECRET === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

// ---- Money --------------------------------------------------------------

// Platform keeps this share of every paid call minute; the friend (host) earns the rest.
export const PLATFORM_FEE_PERCENT = Number(env.PLATFORM_FEE_PERCENT ?? 25);

// Pay-as-you-go rates for "Find a Friend" calls, keyed by the friend's gender.
// ₹100 buys 10 minutes with a male friend or 5 minutes with a female friend.
export const PAYG_RATES = {
  male: { pricePaise: 100_00, minutes: 10 },
  female: { pricePaise: 100_00, minutes: 5 },
  other: { pricePaise: 100_00, minutes: 10 },
};

export function rateKeyFor(gender) {
  return PAYG_RATES[gender] ? gender : 'other';
}

export function perMinutePaise(gender) {
  const r = PAYG_RATES[rateKeyFor(gender)];
  return Math.round(r.pricePaise / r.minutes);
}

// Prepaid minute packages: bigger packs carry a discount over pay-as-you-go.
export const PACKAGES = [
  { id: 'male-30', rateKey: 'male', minutes: 30, pricePaise: 270_00, label: 'Chill pack' },
  { id: 'male-60', rateKey: 'male', minutes: 60, pricePaise: 480_00, label: 'Hangout pack' },
  { id: 'male-120', rateKey: 'male', minutes: 120, pricePaise: 840_00, label: 'Bestie pack' },
  { id: 'female-15', rateKey: 'female', minutes: 15, pricePaise: 270_00, label: 'Chill pack' },
  { id: 'female-30', rateKey: 'female', minutes: 30, pricePaise: 480_00, label: 'Hangout pack' },
  { id: 'female-60', rateKey: 'female', minutes: 60, pricePaise: 840_00, label: 'Bestie pack' },
].map((p) => {
  const paygPaise = perMinutePaise(p.rateKey) * p.minutes;
  return {
    ...p,
    paisePerMinute: Math.floor(p.pricePaise / p.minutes),
    paygPaise,
    discountPercent: Math.round((1 - p.pricePaise / paygPaise) * 100),
  };
});

export const PACKAGE_VALIDITY_DAYS = Number(env.PACKAGE_VALIDITY_DAYS ?? 90);

export const TOPUP_MIN_PAISE = 50_00;
export const TOPUP_MAX_PAISE = 50_000_00;
export const WITHDRAW_MIN_PAISE = 100_00;

// Payments: "razorpay" when keys are present, otherwise "mock" (instant credit, dev only).
export const RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID ?? '';
export const RAZORPAY_KEY_SECRET = env.RAZORPAY_KEY_SECRET ?? '';
export const PAYMENTS_MODE = RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET ? 'razorpay' : 'mock';
if (IS_PROD && PAYMENTS_MODE === 'mock' && env.ALLOW_MOCK_PAYMENTS !== '1') {
  throw new Error('Razorpay keys are required in production (or set ALLOW_MOCK_PAYMENTS=1)');
}

// ---- Calls --------------------------------------------------------------

export const BILLING_INTERVAL_MS = Number(env.BILLING_INTERVAL_MS ?? 60_000); // one billed minute
export const RING_TIMEOUT_MS = Number(env.RING_TIMEOUT_MS ?? 30_000);
export const LOW_BALANCE_MINUTES = 2;

export const ICE_SERVERS = env.ICE_SERVERS
  ? JSON.parse(env.ICE_SERVERS)
  : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

// ---- Guess the name -----------------------------------------------------

export const NAME_GUESS = {
  options: 4, // names to choose from
  coinsPerCorrect: 1,
  dailyCoinLimit: 50, // stops coin farming
  messageMaxLength: 300, // the one intro message a correct guess unlocks
};
export const SKIP_DAYS = 3;

// ---- Profile catalogs (single source of truth for the client too) ------

export const CATALOG = {
  hobbies: [
    'Cooking', 'Dancing', 'Singing', 'Reading', 'Gaming', 'Gym', 'Yoga', 'Running', 'Cycling', 'Trekking',
    'Photography', 'Painting', 'Writing', 'Gardening', 'Cricket', 'Football', 'Badminton', 'Swimming',
    'Chess', 'Travelling', 'Blogging', 'Volunteering', 'Baking', 'Board games', 'Playing guitar', 'Meditation',
  ],
  likes: [
    'Bollywood music', 'K-pop', 'Indie music', 'Classical music', 'Hip hop', 'Rock', 'Rom-coms', 'Thrillers',
    'Anime', 'Web series', 'Stand-up comedy', 'Street food', 'Coffee', 'Chai', 'Pets', 'Long drives', 'Beaches',
    'Mountains', 'Sunsets', 'Rainy days', 'Concerts', 'Road trips', 'Memes', 'Podcasts', 'Fashion', 'Tech',
  ],
  cuisines: ['North Indian', 'South Indian', 'Chinese', 'Italian', 'Mughlai', 'Street food', 'Continental', 'Japanese', 'Bengali', 'Gujarati'],
  weekendStyles: ['Partying with friends', 'Netflix & chill at home', 'Out on an adventure', 'Family time', 'Learning something new', 'Sleeping in'],
  chronotypes: ['Morning person', 'Night owl'],
  destinations: ['Mountains', 'Beaches', 'Big cities', 'Countryside', 'Abroad', 'Spiritual places'],
  lookingFor: ['soulmate', 'friend', 'both'],
  // Decoy names for the guess-the-name game.
  names: {
    female: [
      'Aanya', 'Aditi', 'Aishwarya', 'Ananya', 'Anjali', 'Anushka', 'Bhavana', 'Deepika', 'Divya', 'Gauri', 'Ishita',
      'Kavya', 'Keerthi', 'Lakshmi', 'Meera', 'Megha', 'Nandini', 'Neha', 'Nisha', 'Pooja', 'Priya', 'Radhika',
      'Riya', 'Sahana', 'Sanjana', 'Shreya', 'Sneha', 'Swathi', 'Tanvi', 'Divyasri', 'Varsha', 'Yamini',
    ],
    male: [
      'Aarav', 'Abhinav', 'Aditya', 'Akash', 'Arjun', 'Bharath', 'Deepak', 'Gautam', 'Harsha', 'Karan', 'Karthik',
      'Kiran', 'Manoj', 'Naveen', 'Nikhil', 'Pranav', 'Rahul', 'Rajesh', 'Ravi', 'Rohan', 'Sai', 'Sandeep',
      'Siddharth', 'Sumanth', 'Suresh', 'Tarun', 'Varun', 'Vijay', 'Vikram', 'Vinay', 'Vishal', 'Yash',
    ],
  },
  genders: ['male', 'female', 'other'],
  interestedIn: ['male', 'female', 'everyone'],
};

// The quick-question fields (cuisine, weekend, ...) are optional extras shown on the card.
export const PROFILE_MIN = { hobbies: 3, likes: 3 };
