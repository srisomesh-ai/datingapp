// Demo-only data: fake people with drawn SVG "photos", so the static demo needs no image files.
import { CATALOG } from '../../../server/src/config.js';
import { shuffle } from '../../../server/src/nameGuess.js';

const PEOPLE = [
  ['Ananya', 'female', 'Bengaluru', 'Chai over coffee, always.', true],
  ['Rohan', 'male', 'Mumbai', 'Weekend trekker, weekday coder.', true],
  ['Priya', 'female', 'Delhi', 'Looking for someone to share street food with.', false],
  ['Arjun', 'male', 'Hyderabad', 'Cricket, biryani and bad puns.', false],
  ['Sneha', 'female', 'Pune', 'Bookworm with a playlist for every mood.', true],
  ['Vikram', 'male', 'Chennai', 'Ask me about my plants.', true],
  ['Kavya', 'female', 'Kochi', 'Beach sunsets > everything.', false],
  ['Aditya', 'male', 'Jaipur', 'Amateur photographer, professional foodie.', false],
  ['Isha', 'female', 'Kolkata', "Let's talk about anime and life.", true],
  ['Karan', 'male', 'Ahmedabad', 'Gym in the morning, guitar at night.', false],
];

export function makePeople() {
  return PEOPLE.map(([name, gender, city, bio, isHost], i) => ({
    id: i + 2,
    name,
    gender,
    city,
    bio,
    dob: `${1994 + (i % 8)}-0${1 + (i % 9)}-1${i % 9}`,
    looking_for: CATALOG.lookingFor[i % 3],
    hobbies: shuffle(CATALOG.hobbies).slice(0, 4),
    likes: shuffle(CATALOG.likes).slice(0, 4),
    favorite_cuisine: shuffle(CATALOG.cuisines)[0],
    weekend_style: shuffle(CATALOG.weekendStyles)[0],
    chronotype: shuffle(CATALOG.chronotypes)[0],
    dream_destination: shuffle(CATALOG.destinations)[0],
    is_host: isHost,
    host_available: isHost && i % 4 !== 3,
    host_headline: isHost ? 'Here to listen, laugh and chat 🙂' : '',
    online: !isHost || i % 3 !== 2, // some friends offline so every status shows
  }));
}

const SIZE = 600;

/** A colourful portrait placeholder (no initial, so it doesn't give the name away). */
function avatarSvg(person) {
  const viewBox = `0 0 ${SIZE} ${SIZE}`;
  const hue = (person.id * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},70%,58%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,32%)"/></linearGradient></defs>
<rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
<circle cx="300" cy="240" r="110" fill="#faebdc"/>
<ellipse cx="300" cy="600" rx="200" ry="190" fill="#faebdc"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const demoPhoto = (person) => avatarSvg(person);

export const REPLIES = [
  'Haha hi! You actually guessed my name 😄',
  "That's so sweet. How's your day going?",
  'Same here! What do you do on weekends?',
  "Ooh nice. We should talk on a call sometime 🙂",
  'Tell me something interesting about you!',
];
