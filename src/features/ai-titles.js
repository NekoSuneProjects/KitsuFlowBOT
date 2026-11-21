import { omniConfig, omniConfigured } from './ai/omni.js';

// AI stream-title suggestions through a server-configured OpenAI-compatible endpoint.
// AI_TITLE_* wins when set; otherwise the Omni gateway (OMNI_*) is used.
const envAi = () => {
  const endpoint = String(process.env.AI_TITLE_API_URL || '').trim();
  if (endpoint || !omniConfigured())
    return {
      endpoint,
      model: String(process.env.AI_TITLE_MODEL || '').trim(),
      key: String(process.env.AI_TITLE_API_KEY || '').trim()
    };
  const omni = omniConfig();
  return {
    endpoint: omni.base + '/chat/completions',
    model: String(process.env.OMNI_TITLE_MODEL || omni.chatModel).trim(),
    key: omni.key
  };
};

export function installAiTitles({ app, db, withUser, csrf, access }) {
  // Legacy per-channel AI settings table; kept so existing databases stay unchanged.
  db.exec(
    'CREATE TABLE IF NOT EXISTS creator_ai_settings(channel TEXT PRIMARY KEY,endpoint TEXT NOT NULL,model TEXT NOT NULL,key_encrypted TEXT NOT NULL)'
  );
  const owner = [withUser, access.channelOnly('owner'), csrf];
  // Bound upstream latency so a slow AI model cannot hold OBS/Studio requests open until the reverse proxy times out.
  app.post('/api/creator-ai/suggest', ...owner, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const active = envAi();
    if (!active.endpoint || !active.model)
      return res.status(409).json({
        error: 'Configure OMNI_API_KEY (or AI_TITLE_API_URL and AI_TITLE_MODEL) on the server'
      });
    const game = String(req.body?.game || '')
        .trim()
        .slice(0, 90),
      context = String(req.body?.context || '')
        .trim()
        .slice(0, 200);
    if (!game) return res.status(400).json({ error: 'Enter the game/category first' });
    const configured = Number(process.env.AI_TITLE_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(configured) && configured > 0
        ? Math.max(2000, Math.min(20000, configured))
        : 12000;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const url = new URL(active.endpoint);
      if (!['http:', 'https:'].includes(url.protocol))
        return res.status(500).json({
          error: 'Invalid AI_TITLE_API_URL: expected an HTTP(S) chat completions endpoint'
        });
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          ...(active.key ? { Authorization: 'Bearer ' + active.key } : {}),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: active.model,
          temperature: 0.7,
          max_tokens: 120,
          messages: [
            {
              role: 'system',
              content:
                'Return only one catchy, discoverable live stream title, plain text, at most 110 characters. Mention the supplied game, avoid misleading claims, giveaways, hashtag spam, profanity and platform-policy violations. No quotation marks.'
            },
            { role: 'user', content: 'Game: ' + game + '\nExtra context: ' + context }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        console.warn(
          '[AI title] provider returned HTTP',
          response.status,
          'in',
          Date.now() - started,
          'ms'
        );
        return res.status(502).json({
          error:
            'AI provider returned HTTP ' +
            response.status +
            '. Check its endpoint, model, and credentials.'
        });
      }
      const payload = await response.json();
      const title = String(payload.choices?.[0]?.message?.content || '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 110);
      if (!title)
        return res.status(502).json({
          error: 'AI provider returned no title. Check its OpenAI-compatible response format.'
        });
      return res.json({ title });
    } catch (error) {
      const timedOut =
        controller.signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError';
      console.warn(
        '[AI title]',
        timedOut ? 'upstream timed out' : 'upstream request failed',
        'after',
        Date.now() - started,
        'ms:',
        error.message
      );
      if (!res.headersSent)
        return res.status(timedOut ? 504 : 502).json({
          error: timedOut
            ? 'The AI title service took too long. Try a smaller/faster model, or check the AI server logs.'
            : 'Could not reach the AI title service. Check AI_TITLE_API_URL, networking and AI server logs.'
        });
    } finally {
      clearTimeout(deadline);
    }
  });
}
