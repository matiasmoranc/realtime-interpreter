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
  const [original, setOriginal] = useState('El texto reconocido aparecerá aquí.');
  const [translation, setTranslation] = useState('La traducción en vivo aparecerá aquí.');

  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const dcRef = useRef(null);
  const audioRef = useRef(null);

  const direction = useMemo(() => `${LANGS[from].short} → ${LANGS[to].short}`, [from, to]);

  function translationInstructions(source = from, target = to) {
    return `You are a simultaneous interpreter. Translate all spoken ${LANGS[source].name} into ${LANGS[target].name}. Output only the translation. Preserve meaning, names, numbers and professional terminology. Keep latency low and do not answer the speaker.`;
  }

  function swap() {
    if (meetingOn) return;
    setFrom(to);
    setTo(from);
  }

  function handleEvent(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
      setOriginal(msg.transcript);
    }
    if (msg.type === 'response.audio_transcript.delta' && msg.delta) {
      setTranslation((prev) => (prev === 'La traducción en vivo aparecerá aquí.' ? '' : prev) + msg.delta);
    }
    if (msg.type === 'response.audio_transcript.done' && msg.transcript) {
      setTranslation(msg.transcript);
    }
    if (msg.type === 'error') {
      setStatus(`Error Realtime: ${msg.error?.message || 'desconocido'}`);
    }
  }

  async function connect() {
    setStatus('Creando sesión segura…');
    const tokenRes = await fetch('/api/session', { method: 'POST' });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error || 'No se pudo crear la sesión');

    const ephemeralKey = tokenData.value || tokenData.client_secret?.value;
    if (!ephemeralKey) throw new Error('El servidor no devolvió una credencial temporal');

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
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.addEventListener('message', handleEvent);
    dc.addEventListener('open', () => {
      dc.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions: translationInstructions(),
          input_audio_transcription: { model: 'gpt-realtime-whisper' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.45,
            prefix_padding_ms: 250,
            silence_duration_ms: 350,
            create_response: true,
          },
        },
      }));
      setMeetingOn(true);
      setStatus('Traduciendo en vivo · hablá o reproducí inglés cerca del teléfono');
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp',
      },
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
    try {
      await connect();
    } catch (error) {
      disconnect();
      setStatus(`No se pudo conectar: ${error.message}`);
    }
  }

  function startTalk() {
    setSpeaking(true);
    setTranslation('');
  }
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
          <small>Inglés → español en tus auriculares</small>
        </button>
        <button className={`talk ${speaking ? 'pressed' : ''}`} disabled={!meetingOn}
          onPointerDown={startTalk} onPointerUp={stopTalk} onPointerCancel={stopTalk}>
          <span className="mic">●</span><span>{speaking ? 'Hablando…' : 'Mantener para hablar'}</span>
          <small>Prueba de voz; salida a Cisco se agrega después</small>
        </button>
      </section>

      <section className="transcript">
        <div><span>Original</span><p>{original}</p></div>
        <div><span>Traducción</span><p>{translation || 'Traduciendo…'}</p></div>
      </section>
      <footer>V0.2 · Realtime WebRTC</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
