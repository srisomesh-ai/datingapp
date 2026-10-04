import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../lib/api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [meta, setMeta] = useState(null);
  const [socket, setSocket] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [unread, setUnread] = useState(0);
  const toastId = useRef(0);

  const toast = useCallback((text, kind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user } = await api('/auth/me');
      setUser(user);
      return user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    api('/meta').then(setMeta).catch(() => toast('Could not reach the server', 'error'));
    refreshUser();
  }, [refreshUser, toast]);

  // One socket per logged-in session (cookie auth).
  useEffect(() => {
    if (!user?.id) return undefined;
    const s = io({ withCredentials: true });
    setSocket(s);
    const onSolved = ({ message }) => toast(message, 'love');
    const onMessage = ({ message, from }) => {
      if (from && message.senderId !== user.id && !location.pathname.startsWith(`/chats/${message.senderId}`)) {
        setUnread((n) => n + 1);
        toast(`💬 ${from.name}: ${message.body.slice(0, 60)}`);
      }
    };
    s.on('puzzle:solved', onSolved);
    s.on('message:new', onMessage);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [user?.id, toast]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, refreshUser, meta, socket, toast, toasts, logout, unread, setUnread }),
    [user, refreshUser, meta, socket, toast, toasts, logout, unread],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
