import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import { CallProvider } from './context/CallContext.jsx';
import CallScreen from './components/CallScreen.jsx';
import Auth from './pages/Auth.jsx';
import Discover from './pages/Discover.jsx';
import Play from './pages/Play.jsx';
import Chats from './pages/Chats.jsx';
import Chat from './pages/Chat.jsx';
import Friends from './pages/Friends.jsx';
import Wallet from './pages/Wallet.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';
import { APP_NAME, rupees } from './lib/api.js';

const demoSocket = import.meta.env.VITE_DEMO === '1' ? await import('./demo/demoSocket.js') : null;

function DemoBar() {
  if (!demoSocket) return null;
  return (
    <div className="demo-bar">
      <span>Demo mode · fake people, nothing leaves this browser</span>
      <button onClick={() => demoSocket.simulateIncomingCall()}>📞 Test incoming call</button>
    </div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

function Shell() {
  const { user, unread } = useApp();
  return (
    <CallProvider>
      <div className="shell">
      <DemoBar />
      <header className="topbar">
        <span className="brand">🧩 {APP_NAME}</span>
        <NavLink to="/wallet" className="wallet-pill">{rupees(user.walletPaise)}</NavLink>
        {user.isAdmin && <NavLink to="/admin" className="small">Admin</NavLink>}
      </header>
      <main>
        <Routes>
          <Route path="/" element={user.profileComplete ? <Discover /> : <Navigate to="/profile" replace />} />
          <Route path="/play/:userId" element={<Play />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/chats/:userId" element={<Chat />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/profile" element={<Profile />} />
          {user.isAdmin && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="tabbar">
        <NavLink to="/" end><span>🧩</span>Discover</NavLink>
        <NavLink to="/chats"><span>💬{unread > 0 && <i className="dot-badge" />}</span>Chats</NavLink>
        <NavLink to="/friends"><span>📞</span>Friends</NavLink>
        <NavLink to="/wallet"><span>👛</span>Wallet</NavLink>
        <NavLink to="/profile"><span>🙂</span>Profile</NavLink>
      </nav>
      </div>
      <CallScreen />
    </CallProvider>
  );
}

export default function App() {
  const { user } = useApp();
  return (
    <>
      {user === undefined ? <div className="page center">Loading…</div> : user ? <Shell /> : <Auth />}
      <Toasts />
    </>
  );
}
