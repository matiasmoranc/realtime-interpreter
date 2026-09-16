import React, { useMemo, useState } from 'react';
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

  const direction = useMemo(() => `${LANGS[from].short} → ${LANGS[to].short}`, [from, to]);

  function swap() {
    setFrom(to);
    setTo(from);
  }

  async function toggleMeeting() {
    if (meetingOn) {
      setMeetingOn(false);
      setStatus('Listo para conectar');
      return;
    }
    setStatus('Solicitando micrófono…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMeetingOn(true);
      setStatus('Micrófono listo · falta conectar Realtime API');
    } catch {
      setStatus('No se pudo acceder al micrófono');
    }
  }

  return (
    <main className="shell">
      <header>
        <div className="logo">RI</div>
        <div>
          <h1>Realtime Interpreter</h1>
          <p>Intérprete de voz para reuniones</p>
        </div>
        <span className={`dot ${meetingOn ? 'on' : ''}`} />
      </header>

      <section className="status-card">
        <span className="eyebrow">ESTADO</span>
        <strong>{status}</strong>
        <span className="direction">{direction}</span>
      </section>

      <section className="languages">
        <div className="lang">
          <span>Escucho</span>
          <strong>{LANGS[from].flag} {LANGS[from].name}</strong>
        </div>
        <button className="swap" onClick={swap} aria-label="Intercambiar idiomas">⇄</button>
        <div className="lang right">
          <span>Traduzco a</span>
          <strong>{LANGS[to].flag} {LANGS[to].name}</strong>
        </div>
      </section>

      <section className="controls">
        <button className={`listen ${meetingOn ? 'active' : ''}`} onClick={toggleMeeting}>
          <span className="icon">{meetingOn ? '■' : '▶'}</span>
          <span>{meetingOn ? 'Detener escucha' : 'Escuchar reunión'}</span>
          <small>Inglés → español en tus auriculares</small>
        </button>

        <button
          className={`talk ${speaking ? 'pressed' : ''}`}
          onPointerDown={() => setSpeaking(true)}
          onPointerUp={() => setSpeaking(false)}
          onPointerCancel={() => setSpeaking(false)}
        >
          <span className="mic">●</span>
          <span>{speaking ? 'Hablando…' : 'Mantener para hablar'}</span>
          <small>Español → inglés para la reunión</small>
        </button>
      </section>

      <section className="transcript">
        <div>
          <span>Original</span>
          <p>El texto reconocido aparecerá aquí.</p>
        </div>
        <div>
          <span>Traducción</span>
          <p>La traducción en vivo aparecerá aquí.</p>
        </div>
      </section>

      <footer>V0.1 · Prototipo de audio</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
