# Realtime Interpreter

Mobile-first prototype for live English ↔ Spanish speech interpretation during meetings.

## Goal

- Meeting audio: English → Spanish audio for the user.
- User speech: Spanish → English audio for the meeting.
- Streaming translation rather than waiting for a complete sentence.
- Keep the OpenAI API key server-side.

## Current V0.1

The UI and microphone-permission test are ready. `api/session.js` contains the server-side session bootstrap for `gpt-realtime-translate`.

## Local setup

```bash
npm install
npm run dev
```

For the Realtime API, configure `OPENAI_API_KEY` as a server environment variable. Never put it in frontend code or commit it to GitHub.

## Next milestone

Connect the browser to the Realtime API over WebRTC, stream microphone audio, play translated audio, and expose live transcript events. Then test the physical/virtual audio route into the meeting PC.
