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

// Spend coins on a short "sample" call with anyone; coins are taken only if they accept.
export const SAMPLE_CALL = {
  coins: 10,
  seconds: Number(env.SAMPLE_CALL_SECONDS ?? 60),
  perPersonHours: 24, // one accepted sample call to the same person per day
};
export const LOW_BALANCE_MINUTES = 2;

export const ICE_SERVERS = env.ICE_SERVERS
  ? JSON.parse(env.ICE_SERVERS)
  : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

// TURN relay (coturn with `use-auth-secret`) so calls connect on mobile data / strict NATs.
// Each logged-in user gets short-lived credentials; the secret never leaves the server.
export const TURN_URLS = (env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
export const TURN_SECRET = env.TURN_SECRET ?? '';
export const TURN_TTL_SECONDS = 6 * 3600;

// ---- Guess the name -----------------------------------------------------

// See a photo, pick the right name: you're connected (chat opens for both of you).
export const NAME_GUESS = {
  options: 4, // names to choose from (one look-alike always fits the hint too)
  coinsPerCorrect: 1,
  dailyCoinLimit: 10, // stops coin farming
  guessesPerDay: Number(env.GUESSES_PER_DAY ?? 20), // stops tapping through every photo
  retryHours: 24, // after a wrong guess, try the same person again later
};

// Chat between connected people: free up to a limit, then pay to keep chatting.
export const CHAT = {
  freeMessagesPerPerson: 10, // each person, per chat
  unlockPricePaise: 49_00, // unlimited messages from you in that chat
};

// Calls between connected people are paid (no free calls). Platform keeps it all.
export const MATCH_CALL = { rateKey: 'match', paisePerMinute: 5_00 };
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
  // Names for the guess-the-name options (look-alikes are picked from these).
  names: {
    female: [
      'Aanya', 'Aarti', 'Aditi', 'Akshara', 'Amala', 'Amrita', 'Ananya', 'Anisha', 'Anjali', 'Anjana', 'Ankita',
      'Anusha', 'Anushka', 'Archana', 'Asha', 'Bhavana', 'Bhavya', 'Chaitra', 'Charu', 'Deepa', 'Deepika', 'Deepti',
      'Divya', 'Durga', 'Gauri', 'Gayathri', 'Geetha', 'Harini', 'Harika', 'Isha', 'Ishita', 'Jaya', 'Jyothi',
      'Kajal', 'Kavya', 'Kavitha', 'Keerthi', 'Komal', 'Lakshmi', 'Lalitha', 'Latha', 'Madhu', 'Mahima', 'Manasa',
      'Meena', 'Meera', 'Megha', 'Monika', 'Nandini', 'Neha', 'Nidhi', 'Nisha', 'Nithya', 'Pallavi', 'Pavani',
      'Pooja', 'Prachi', 'Preethi', 'Priya', 'Priyanka', 'Radha', 'Radhika', 'Rashmi', 'Rekha', 'Renu', 'Riya',
      'Rupa', 'Sahana', 'Sakshi', 'Sana', 'Sanjana', 'Sapna', 'Sarika', 'Shalini', 'Shreya', 'Shruti', 'Sindhu',
      'Sneha', 'Sonia', 'Sowmya', 'Sravani', 'Sruthi', 'Suma', 'Supriya', 'Swathi', 'Swetha', 'Tanvi', 'Tanya',
      'Usha', 'Vaishali', 'Varsha', 'Vidya', 'Yamini',
    ],
    male: [
      'Aarav', 'Abhay', 'Abhinav', 'Abhishek', 'Aditya', 'Ajay', 'Akash', 'Akhil', 'Amar', 'Amit', 'Anand', 'Anil',
      'Ankit', 'Arjun', 'Arun', 'Ashok', 'Bharath', 'Chetan', 'Darshan', 'Deepak', 'Dev', 'Dinesh', 'Ganesh',
      'Gautam', 'Girish', 'Harish', 'Harsha', 'Hemanth', 'Jagan', 'Jay', 'Karan', 'Karthik', 'Kiran', 'Kishore',
      'Krishna', 'Kunal', 'Lokesh', 'Madhav', 'Mahesh', 'Manish', 'Manoj', 'Mohan', 'Mukesh', 'Naresh', 'Naveen',
      'Nikhil', 'Nitin', 'Pavan', 'Pradeep', 'Pranav', 'Prasad', 'Pratap', 'Rahul', 'Rajan', 'Rajesh', 'Rakesh',
      'Ramesh', 'Ravi', 'Rohan', 'Rohit', 'Sachin', 'Sagar', 'Sai', 'Sandeep', 'Sanjay', 'Santosh', 'Satish',
      'Shiva', 'Siddharth', 'Sumanth', 'Sunil', 'Suresh', 'Tarun', 'Uday', 'Varun', 'Venkat', 'Vijay', 'Vikas',
      'Vikram', 'Vinay', 'Vinod', 'Vishal', 'Vivek', 'Yash', 'Yogesh',
    ],
  },
  genders: ['male', 'female', 'other'],
  interestedIn: ['male', 'female', 'everyone'],
};

// The quick-question fields (cuisine, weekend, ...) are optional extras shown on the card.
export const PROFILE_MIN = { hobbies: 3, likes: 3 };
