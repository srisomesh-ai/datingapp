// Placeholder brand: the app has no name yet. Change it here (and in index.html / manifest).
export const APP_NAME = 'AppName';

// Static demo build (no server): `npm run build:demo`. Everything runs in the browser.
export const DEMO = import.meta.env.VITE_DEMO === '1';
const demo = import.meta.env.VITE_DEMO === '1' ? await import('../demo/demoApi.js') : null;

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** JSON API helper. Auth rides on the httpOnly cookie set at login. */
export async function api(path, { method = 'GET', body } = {}) {
  if (demo) {
    try {
      return await demo.demoApi(path, { method, body });
    } catch (err) {
      throw new ApiError(err.status ?? 500, err.message, err.data);
    }
  }
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  return data;
}

export const rupees = (paise) => {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString('en-IN') : r.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const photoUrl = (user) => (demo ? demo.demoPhotoUrl(user) : `/api/photos/${user.id}/full?v=${user.photoVersion ?? 0}`);

/** Name to show for someone; before you've guessed it, the masked hint. */
export const displayName = (user) => user?.name ?? user?.nameMask ?? 'Someone';

export const timeAgo = (sqlDate) => {
  if (!sqlDate) return '';
  const d = new Date(sqlDate.includes('T') ? sqlDate : sqlDate.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const labelFor = {
  soulmate: 'Looking for a soulmate',
  friend: 'Looking for friends',
  both: 'Open to love & friendship',
};
