// Presence registry and a way for HTTP routes to push events to connected users.
let io = null;
const sockets = new Map(); // userId -> Set<socketId>

export function setIo(server) {
  io = server;
}

export function addSocket(userId, socketId) {
  if (!sockets.has(userId)) sockets.set(userId, new Set());
  sockets.get(userId).add(socketId);
}

/** @returns true when this was the user's last socket */
export function removeSocket(userId, socketId) {
  const set = sockets.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    sockets.delete(userId);
    return true;
  }
  return false;
}

export const isOnline = (userId) => sockets.has(userId);

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}
