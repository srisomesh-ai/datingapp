// Voice/video calling over WebRTC. The server relays signaling and handles billing.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext.jsx';
import { api } from '../lib/api.js';

const CallContext = createContext(null);
export const useCall = () => useContext(CallContext);

const IDLE = { phase: 'idle' };

function ringer() {
  let ctx;
  let timer;
  return {
    start() {
      try {
        ctx = new AudioContext();
        const beep = () => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 520;
          g.gain.setValueAtTime(0.15, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
          o.connect(g).connect(ctx.destination);
          o.start();
          o.stop(ctx.currentTime + 0.8);
          navigator.vibrate?.([300, 200, 300]);
        };
        beep();
        timer = setInterval(beep, 2000);
      } catch {
        /* audio not allowed yet */
      }
    },
    stop() {
      clearInterval(timer);
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}

export function CallProvider({ children }) {
  const { socket, meta, toast, refreshUser } = useApp();
  const [call, setCall] = useState(IDLE);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const pcRef = useRef(null);
  const localRef = useRef(null);
  const pendingCandidates = useRef([]);
  const callRef = useRef(IDLE);
  const ring = useRef(ringer());
  callRef.current = call;

  const cleanupMedia = useCallback(() => {
    ring.current.stop();
    pcRef.current?.close();
    pcRef.current = null;
    pendingCandidates.current = [];
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
  }, []);

  const getMedia = useCallback(async (media) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: media === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const createPeer = useCallback(
    (callId, iceServers) => {
      const pc = new RTCPeerConnection({ iceServers: iceServers ?? meta?.iceServers ?? [] });
      localRef.current?.getTracks().forEach((t) => pc.addTrack(t, localRef.current));
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('rtc:signal', { callId, data: { type: 'candidate', candidate: e.candidate } });
      };
      pc.ontrack = (e) => setRemoteStream(e.streams[0]);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          toast('Connection failed. Check your network.', 'error');
          socket.emit('call:end', { callId });
        }
      };
      pcRef.current = pc;
      return pc;
    },
    [meta, socket, toast],
  );

  const flushCandidates = async (pc) => {
    for (const c of pendingCandidates.current) await pc.addIceCandidate(c).catch(() => {});
    pendingCandidates.current = [];
  };

  // ---- socket events ----------------------------------------------------
  useEffect(() => {
    if (!socket) return undefined;

    const onIncoming = (payload) => {
      if (callRef.current.phase !== 'idle' && callRef.current.phase !== 'ended') return;
      ring.current.start();
      setCall({ phase: 'incoming', role: 'callee', ...payload, peer: payload.from });
    };

    const onAccepted = async ({ callId }) => {
      const c = callRef.current;
      if (c.callId !== callId) return;
      ring.current.stop();
      setCall((prev) => ({ ...prev, phase: 'active', startedAt: Date.now() }));
      const pc = createPeer(callId, c.iceServers);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('rtc:signal', { callId, data: { type: 'offer', sdp: offer } });
    };

    const onSignal = async ({ callId, data }) => {
      const pc = pcRef.current;
      if (!pc || callRef.current.callId !== callId) return;
      if (data.type === 'offer') {
        await pc.setRemoteDescription(data.sdp);
        await flushCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('rtc:signal', { callId, data: { type: 'answer', sdp: answer } });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(data.sdp);
        await flushCandidates(pc);
      } else if (data.type === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else pendingCandidates.current.push(data.candidate);
      }
    };

    const onBilling = (b) => {
      if (callRef.current.callId === b.callId) setCall((prev) => ({ ...prev, billing: b }));
    };
    const onLow = ({ callId, minutesLeft }) => {
      if (callRef.current.callId === callId) {
        toast(minutesLeft < 1 ? 'Last minute! Top up to keep talking.' : `Only ${minutesLeft} min left. Top up to keep talking.`, 'warn');
      }
    };
    const onEnded = (summary) => {
      if (callRef.current.callId !== summary.callId) return;
      cleanupMedia();
      if (summary.reason === 'answered_elsewhere') return setCall(IDLE);
      setCall((prev) => ({ ...prev, phase: 'ended', summary }));
      refreshUser();
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('rtc:signal', onSignal);
    socket.on('call:billing', onBilling);
    socket.on('call:low-balance', onLow);
    socket.on('call:ended', onEnded);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('rtc:signal', onSignal);
      socket.off('call:billing', onBilling);
      socket.off('call:low-balance', onLow);
      socket.off('call:ended', onEnded);
    };
  }, [socket, createPeer, cleanupMedia, toast, refreshUser]);

  // ---- actions ----------------------------------------------------------
  const startCall = useCallback(
    async (peer, media, mode) => {
      if (!socket) return;
      if (callRef.current.phase !== 'idle' && callRef.current.phase !== 'ended') return toast('You are already in a call', 'warn');
      try {
        await getMedia(media);
      } catch {
        return toast(`Allow ${media === 'video' ? 'camera and microphone' : 'microphone'} access to call`, 'error');
      }
      setCall({ phase: 'outgoing', role: 'caller', peer, media, mode });
      socket.emit('call:start', { to: peer.id, media, mode }, (res) => {
        if (res?.error) {
          cleanupMedia();
          setCall(IDLE);
          toast(res.error, 'error');
          return;
        }
        setCall((prev) => ({ ...prev, callId: res.callId, iceServers: res.iceServers, rate: res.rate, limitSeconds: res.limitSeconds }));
      });
    },
    [socket, getMedia, cleanupMedia, toast],
  );

  const accept = useCallback(async () => {
    const c = callRef.current;
    if (c.phase !== 'incoming') return;
    ring.current.stop();
    try {
      await getMedia(c.media);
    } catch {
      toast('Allow microphone/camera access to answer', 'error');
      socket.emit('call:reject', { callId: c.callId });
      cleanupMedia();
      return setCall(IDLE);
    }
    // Create the peer before accepting so the caller's offer always finds it.
    // Fresh ICE config carries this user's short-lived TURN credentials.
    const ice = await api('/ice').catch(() => null);
    createPeer(c.callId, ice?.iceServers ?? meta?.iceServers);
    socket.emit('call:accept', { callId: c.callId }, (res) => {
      if (res?.error) {
        cleanupMedia();
        setCall(IDLE);
        return toast(res.error, 'error');
      }
      setCall((prev) => ({ ...prev, phase: 'active', startedAt: Date.now() }));
    });
  }, [socket, meta, getMedia, createPeer, cleanupMedia, toast]);

  const reject = useCallback(() => {
    const c = callRef.current;
    socket?.emit('call:reject', { callId: c.callId });
    cleanupMedia();
    setCall(IDLE);
  }, [socket, cleanupMedia]);

  const hangup = useCallback(() => {
    const c = callRef.current;
    if (c.callId) socket?.emit('call:end', { callId: c.callId });
    else {
      cleanupMedia();
      setCall(IDLE);
    }
  }, [socket, cleanupMedia]);

  const dismiss = useCallback(() => setCall(IDLE), []);

  const toggleMute = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  }, []);

  const toggleCamera = useCallback(() => {
    const track = localRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCameraOff(!track.enabled);
    }
  }, []);

  const switchCamera = useCallback(async () => {
    const current = localRef.current?.getVideoTracks()[0];
    if (!current || !pcRef.current) return;
    const facing = current.getSettings().facingMode === 'environment' ? 'user' : 'environment';
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      const track = fresh.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(track);
      localRef.current.removeTrack(current);
      current.stop();
      localRef.current.addTrack(track);
      setLocalStream(new MediaStream(localRef.current.getTracks()));
    } catch {
      toast('Could not switch camera', 'error');
    }
  }, [toast]);

  const value = useMemo(
    () => ({ call, localStream, remoteStream, muted, cameraOff, startCall, accept, reject, hangup, dismiss, toggleMute, toggleCamera, switchCamera }),
    [call, localStream, remoteStream, muted, cameraOff, startCall, accept, reject, hangup, dismiss, toggleMute, toggleCamera, switchCamera],
  );
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
