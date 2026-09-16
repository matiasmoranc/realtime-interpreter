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

  const streamRef = useRef(null);
  const listenPcRef = useRef(null);
  const talkPcRef = useRef(null);
  const talkTrackRef = useRef(null);
  const listenAudioRef = useRef(null);
  const talkAudioRef = useRef(null);

  const direction = useMemo(() => `${LANGS[from].short} → ${LANGS[to].short}`, [from, to]);

  function swap() {
    if (meetingOn) return;
    setFrom(to);
    setTo(from);
  }

  function handleListenEvent(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'session.input_transcript.delta' && msg.delta) {
      setOriginal((prev) => (prev === 'El texto original aparecerá aquí.' ? '' : prev) + msg.delta);
    }
    if ((msg.type === 'session.input_transcript.completed' || msg.type === 'session.input_transcript.done') && msg.transcript) {
      setOriginal(msg.transcript);
    }
    if (msg.type === 'session.output_transcript.delta' && msg.delta) {
      setTranslation((prev) => (prev === 'La traducción en vivo aparecerá aquí.' ? '' : prev) + msg.delta);
    }
    if ((msg.type === 'session.output_transcript.completed' || msg.type === 'session.output_transcript.done') && msg.transcript) {
      setTranslation(msg.transcript);
    }
    if (msg.type === 'error') setStatus(`Error Realtime: ${msg.error?.message || 'desconocido'}`);
  }

  async function getSecret(targetLanguage) {
    const response = await fetch('/api/session', {
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

  async function connect() {
    setStatus('Preparando traducción bidireccional…');
    const [listenSecret, talkSecret] = await Promise.all([getSecret(to), getSecret(from)]);

    setStatus('Solicitando micrófono…');
    // This mic is capturing another device / meeting speaker. Browser voice processing
    // can mistake that continuous external speech for echo/noise and suppress it.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    streamRef.current = stream;
    const micTrack = stream.getAudioTracks()[0];

    const listenAudio = new Audio();
    listenAudio.autoplay = true;
    listenAudio.playsInline = true;
    listenAudioRef.current = listenAudio;

    const talkAudio = new Audio();
    talkAudio.autoplay = true;
    talkAudio.playsInline = true;
    talkAudio.volume = 1;
    talkAudioRef.current = talkAudio;

    listenPcRef.current = await createTranslationPeer(listenSecret, micTrack, handleListenEvent, listenAudio);

    const talkTrack = micTrack.clone();
    talkTrack.enabled = false;
    talkTrackRef.current = talkTrack;
    talkPcRef.current = await createTranslationPeer(talkSecret, talkTrack, null, talkAudio);

    setMeetingOn(true);
    setStatus('Traducción continua activa · mantené el botón rojo para hablar en español');
  }

  function disconnect() {
    listenPcRef.current?.close();
    talkPcRef.current?.close();
    talkTrackRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (listenAudioRef.current) listenAudioRef.current.srcObject = null;
    if (talkAudioRef.current) talkAudioRef.current.srcObject = null;
    listenPcRef.current = null;
    talkPcRef.current = null;
    talkTrackRef.current = null;
    streamRef.current = null;
    setSpeaking(false);
    setMeetingOn(false);
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
    setStatus('Traducción continua activa · mantené el botón rojo para hablar en español');
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
          <small>Inglés → español continuo en tus auriculares</small>
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
      <footer>V0.5 · Captura continua</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
