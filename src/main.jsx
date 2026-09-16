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

  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const dcRef = useRef(null);
  const audioRef = useRef(null);
  const direction = useMemo(() => `${LANGS[from].short} → ${LANGS[to].short}`, [from, to]);

  function swap() {
    if (meetingOn) return;
    setFrom(to);
    setTo(from);
  }

  function handleEvent(event) {
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
    if (msg.type === 'error') {
      setStatus(`Error Realtime: ${msg.error?.message || 'desconocido'}`);
    }
  }

  async function connect() {
    setStatus('Creando sesión de traducción…');
    const tokenRes = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: to }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error?.message || tokenData.error || 'No se pudo crear la sesión');

    const ephemeralKey = tokenData.client_secret || tokenData.value || tokenData.client_secret?.value;
    const secret = typeof ephemeralKey === 'string' ? ephemeralKey : ephemeralKey?.value;
    if (!secret) throw new Error('El servidor no devolvió una credencial temporal');

    setStatus('Solicitando micrófono…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;
    audioRef.current = audio;
    pc.ontrack = ({ streams }) => {
      audio.srcObject = streams[0];
      audio.play().catch(() => {});
    };

    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.addEventListener('message', handleEvent);
    dc.addEventListener('open', () => {
      setMeetingOn(true);
      setStatus('Traduciendo en vivo · reproducí inglés cerca del teléfono');
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch('https://api.openai.com/v1/realtime/translations/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!sdpRes.ok) throw new Error(await sdpRes.text());
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
  }

  function disconnect() {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioRef.current) audioRef.current.srcObject = null;
    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    setMeetingOn(false);
    setStatus('Listo para conectar');
  }

  async function toggleMeeting() {
    if (meetingOn) return disconnect();
    try { await connect(); }
    catch (error) { disconnect(); setStatus(`No se pudo conectar: ${error.message}`); }
  }

  function startTalk() { setSpeaking(true); }
  function stopTalk() { setSpeaking(false); }

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
          <small>{LANGS[from].name} → {LANGS[to].name} en tus auriculares</small>
        </button>
        <button className={`talk ${speaking ? 'pressed' : ''}`} disabled={!meetingOn}
          onPointerDown={startTalk} onPointerUp={stopTalk} onPointerCancel={stopTalk}>
          <span className="mic">●</span><span>{speaking ? 'Hablando…' : 'Mantener para hablar'}</span>
          <small>Salida a Cisco se agrega después</small>
        </button>
      </section>
      <section className="transcript">
        <div><span>Original</span><p>{original}</p></div>
        <div><span>Traducción</span><p>{translation}</p></div>
      </section>
      <footer>V0.3 · Realtime Translation</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
