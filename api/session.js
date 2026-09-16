// Server-side endpoint for creating a short-lived OpenAI Realtime Translation session.
// OPENAI_API_KEY stays only on the server.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY is not configured yet', setupRequired: true });
  }

  try {
    const targetLanguage = req.body?.targetLanguage || 'es';
    const response = await fetch('https://api.openai.com/v1/realtime/translations/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-realtime-translate',
          audio: {
            input: {
              transcription: { model: 'gpt-realtime-whisper' },
              // The iPhone is listening to meeting audio coming from another device,
              // so this is a far-field source rather than a close-talking headset mic.
              noise_reduction: { type: 'far_field' },
            },
            output: { language: targetLanguage },
          },
        },
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Could not create Realtime Translation session' });
  }
}
