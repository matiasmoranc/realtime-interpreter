import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const LANGS = {
  en: { name: 'English', short: 'EN', flag: '🇬🇧' },
  es: { name: 'Español', short: 'ES', flag: '🇺🇾' },
};

function App() {
  const [meetingOn, setMeetingOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [from, setFrom] = useState('en');
  const [to, setTo] = useState('es');
  const [status, setStatus] = useState('Listo para conectar');
  const [original, setOriginal] = useState('El texto original aparecerá aquí.');
  const [translation, setTranslation] = useState('La traducción en vivo aparecerá aquí.');
  const [streamHealth, setStreamHealth] = useState('');

  const streamRef = useRef(null);
  const systemStreamRef = useRef(null);
  const listenPcRef = useRef(null);
  const talkPcRef = useRef(null);
  const talkTrackRef = useRef(null);
  const listenAudioRef = useRef(null);
  const talkAudioRef = useRef(null);
  const lastInputRef = useRef(0);
  const lastOutputRef = useRef(0);
  const healthTimerRef = useRef(null);

  const direction = useMemo(() => `${LANGS[from].short} → ${LANGS[to].short}`, [from, to]);

  function swap() {
    if (meetingOn) return;
    setFrom(to);
    setTo(from);
  }

  function appendText(setter, placeholder, delta) {
    setter((prev) => {
      const base = prev === placeholder ? '' : prev;
      return (base + delta).slice(-5000);
    });
  }

  function handleListenEvent(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    // Translation sessions are continuous. Deltas are the authoritative live stream;
    // do not replace the accumulated text when a completed segment arrives.
    if (msg.type === 'session.input_transcript.delta' && msg.delta) {
      lastInputRef.current = Date.now();
      appendText(setOriginal, 'El texto original aparecerá aquí.', msg.delta);
    }
    if (msg.type === 'session.output_transcript.delta' && msg.delta) {
      lastOutputRef.current = Date.now();
      appendText(setTranslation, 'La traducción en vivo aparecerá aquí.', msg.delta);
    }
    if (msg.type === 'error') {
      setStatus(`Error Realtime: ${msg.error?.message || 'desconocido'}`);
    }
  }

  async function getSecret(targetLanguage) {
    const response = await fetch('https://realtime-interpreter-amber.vercel.app/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || data.error || 'No se pudo crear la sesión');
    const candidate = data.client_secret || data.value || data.client_secret?.value;
    const secret = typeof candidate === 'string' ? candidate : candidate?.value;
    if (!secret) throw new Error('El servidor no devolvió una credencial temporal');
    return secret;
  }

  async function createTranslationPeer(secret, track, onMessage, audio) {
    const pc = new RTCPeerConnection();
    const stream = new MediaStream([track]);
    pc.addTrack(track, stream);
    pc.ontrack = ({ streams }) => {
      audio.srcObject = streams[0];
      audio.play().catch(() => {});
    };
    const dc = pc.createDataChannel('oai-events');
    if (onMessage) dc.addEventListener('message', onMessage);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch('https://api.openai.com/v1/realtime/translations/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!response.ok) throw new Error(await response.text());
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    return pc;
  }

  function startHealthMonitor(track, pc) {
    clearInterval(healthTimerRef.current);
    healthTimerRef.current = setInterval(() => {
      if (!track || !pc) return;
      const connected = pc.connectionState === 'connected';
      const micLive = track.readyState === 'live' && !track.muted && track.enabled;
      const now = Date.now();
      const inputAge = lastInputRef.current ? Math.round((now - lastInputRef.current) / 1000) : null;
      const outputAge = lastOutputRef.current ? Math.round((now - lastOutputRef.current) / 1000) : null;
      setStreamHealth(`Mic ${micLive ? 'OK' : 'PAUSADO'} · WebRTC ${connected ? 'OK' : pc.connectionState}${inputAge !== null ? ` · entrada ${inputAge}s` : ''}${outputAge !== null ? ` · traducción ${outputAge}s` : ''}`);
    }, 1000);
  }

  async function connect() {
    setStatus('Preparando traducción bidireccional…');
    const [listenSecret, talkSecret] = await Promise.all([getSecret(to), getSecret(from)]);

    setStatus('Elegí la pantalla o ventana de la reunión y activá «Compartir audio»…');
    const systemStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    systemStreamRef.current = systemStream;
    const meetingTrack = systemStream.getAudioTracks()[0];
    if (!meetingTrack) {
      systemStream.getTracks().forEach((track) => track.stop());
      systemStreamRef.current = null;
      throw new Error('No se compartió audio. Volvé a intentar y activá «Compartir audio» en el selector de Windows.');
    }

    setStatus('Solicitando micrófono para ES → EN…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    const micTrack = stream.getAudioTracks()[0];

    meetingTrack.onended = () => disconnect();

    const listenAudio = new Audio();
    listenAudio.autoplay = true;
    listenAudio.playsInline = true;
    // Subtitle mode: don't play the translated Spanish back into the system audio,
    // otherwise system capture can hear itself and create a translation loop.
    listenAudio.muted = true;
    listenAudioRef.current = listenAudio;

    const talkAudio = new Audio();
    talkAudio.autoplay = true;
    talkAudio.playsInline = true;
    talkAudio.volume = 1;
    talkAudioRef.current = talkAudio;

    listenPcRef.current = await createTranslationPeer(listenSecret, meetingTrack, handleListenEvent, listenAudio);

    const talkTrack = micTrack.clone();
    talkTrack.enabled = false;
    talkTrackRef.current = talkTrack;
    talkPcRef.current = await createTranslationPeer(talkSecret, talkTrack, null, talkAudio);

    lastInputRef.current = 0;
    lastOutputRef.current = 0;
    startHealthMonitor(meetingTrack, listenPcRef.current);
    setMeetingOn(true);
    setStatus('Subtítulos EN → ES activos · el audio de la reunión se captura directamente desde Windows');
  }

  function disconnect() {
    clearInterval(healthTimerRef.current);
    healthTimerRef.current = null;
    listenPcRef.current?.close();
    talkPcRef.current?.close();
    talkTrackRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    systemStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (listenAudioRef.current) listenAudioRef.current.srcObject = null;
    if (talkAudioRef.current) talkAudioRef.current.srcObject = null;
    listenPcRef.current = null;
    talkPcRef.current = null;
    talkTrackRef.current = null;
    streamRef.current = null;
    systemStreamRef.current = null;
    setSpeaking(false);
    setMeetingOn(false);
    setStreamHealth('');
    setStatus('Listo para conectar');
  }

  async function toggleMeeting() {
    if (meetingOn) return disconnect();
    try { await connect(); }
    catch (error) { disconnect(); setStatus(`No se pudo conectar: ${error.message}`); }
  }

  function startTalk() {
    if (!meetingOn || !talkTrackRef.current) return;
    talkTrackRef.current.enabled = true;
    setSpeaking(true);
    setStatus('ES → EN activo · seguí manteniendo para hablar');
  }

  function stopTalk() {
    if (talkTrackRef.current) talkTrackRef.current.enabled = false;
    setSpeaking(false);
    setStatus('Subtítulos EN → ES activos · audio capturado directamente desde Windows');
  }

  return (
    <main className="shell">
      <header>
        <div className="logo">RI</div>
        <div><h1>Realtime Interpreter</h1><p>Intérprete de voz para reuniones</p></div>
        <span className={`dot ${meetingOn ? 'on' : ''}`} />
      </header>
      <section className="status-card">
        <span className="eyebrow">ESTADO</span><strong>{status}</strong><span className="direction">{direction}</span>
        {meetingOn && streamHealth && <small style={{display:'block', marginTop:8, opacity:.7}}>{streamHealth}</small>}
      </section>
      <section className="languages">
        <div className="lang"><span>Escucho</span><strong>{LANGS[from].flag} {LANGS[from].name}</strong></div>
        <button className="swap" onClick={swap} disabled={meetingOn} aria-label="Intercambiar idiomas">⇄</button>
        <div className="lang right"><span>Traduzco a</span><strong>{LANGS[to].flag} {LANGS[to].name}</strong></div>
      </section>
      <section className="controls">
        <button className={`listen ${meetingOn ? 'active' : ''}`} onClick={toggleMeeting}>
          <span className="icon">{meetingOn ? '■' : '▶'}</span>
          <span>{meetingOn ? 'Detener escucha' : 'Escuchar reunión'}</span>
          <small>Captura el audio de Windows · inglés → subtítulos en español</small>
        </button>
        <button className={`talk ${speaking ? 'pressed' : ''}`} disabled={!meetingOn}
          onPointerDown={startTalk} onPointerUp={stopTalk} onPointerCancel={stopTalk}>
          <span className="mic">●</span><span>{speaking ? 'Traduciendo al inglés…' : 'Mantener para hablar'}</span>
          <small>Español → inglés · no detiene la escucha</small>
        </button>
      </section>
      <section className="transcript">
        <div><span>Original reunión</span><p>{original}</p></div>
        <div><span>Traducción al español</span><p>{translation}</p></div>
      </section>
      <footer>V0.7 · Windows system audio + live subtitles</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
