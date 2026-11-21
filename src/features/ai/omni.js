// Client for the OmniRoute AI gateway (OpenAI-compatible, https://omni.nekosunevr.co.uk/v1).
//
// Used endpoints (request shapes from OmniRoute's src/shared/validation/schemas/apiV1.ts):
//   POST /chat/completions  OpenAI chat format
//   POST /moderations       OpenAI moderation format ({ model, input })
//   POST /search            { query (<=500 chars), max_results, search_type, filters.safe_search }
//                           -> { results: [{ title, url, snippet, ... }] }
// All calls use "Authorization: Bearer OMNI_API_KEY" and have hard timeouts.

export function omniConfig(env = process.env) {
  const base = String(env.OMNI_BASE_URL || 'https://omni.nekosunevr.co.uk/v1')
    .trim()
    .replace(/\/+$/, '');
  return {
    base,
    key: String(env.OMNI_API_KEY || '').trim(),
    chatModel: String(env.OMNI_CHAT_MODEL || 'auto').trim(),
    moderationModel: String(env.OMNI_MODERATION_MODEL || 'omni-moderation-latest').trim(),
    // Search provider is optional: OmniRoute fails over between configured providers itself.
    searchProvider: String(env.OMNI_SEARCH_PROVIDER || '').trim()
  };
}

export const omniConfigured = (cfg = omniConfig()) => Boolean(cfg.base && cfg.key);

export function createOmniClient(getConfig = omniConfig) {
  async function call(path, body, timeoutMs) {
    const cfg = getConfig();
    if (!omniConfigured(cfg)) throw Error('Omni is not configured (set OMNI_API_KEY)');
    const response = await fetch(cfg.base + path, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + cfg.key,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.message || '';
      throw Error(
        'Omni ' +
          path +
          ' returned ' +
          response.status +
          (detail ? ': ' + String(detail).slice(0, 160) : '')
      );
    }
    return data;
  }

  // Returns the assistant text, or '' when the model gave nothing.
  async function chat(
    messages,
    { model, maxTokens = 200, temperature = 0.4, timeoutMs = 20000 } = {}
  ) {
    const data = await call(
      '/chat/completions',
      { model: model || getConfig().chatModel, messages, max_tokens: maxTokens, temperature },
      timeoutMs
    );
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  // Returns { flagged, categories: [names] }. Throws when moderation is unavailable, so callers
  // can fail closed.
  async function moderate(input) {
    const data = await call(
      '/moderations',
      { model: getConfig().moderationModel, input: String(input).slice(0, 4000) },
      10000
    );
    const result = data?.results?.[0];
    if (!result || typeof result.flagged !== 'boolean')
      throw Error('Omni moderation returned no result');
    const categories = Object.entries(result.categories || {})
      .filter(([, value]) => value === true)
      .map(([name]) => name);
    return { flagged: result.flagged, categories };
  }

  // Strict safe-search web results: [{ title, url, snippet }].
  async function search(query, { maxResults = 3 } = {}) {
    const cfg = getConfig();
    const data = await call(
      '/search',
      {
        query: String(query).trim().slice(0, 500),
        max_results: maxResults,
        search_type: 'web',
        filters: { safe_search: 'strict' },
        ...(cfg.searchProvider ? { provider: cfg.searchProvider } : {})
      },
      12000
    );
    return (Array.isArray(data?.results) ? data.results : [])
      .slice(0, maxResults)
      .map(r => ({
        title: String(r?.title || '').slice(0, 160),
        url: String(r?.url || '').slice(0, 300),
        snippet: String(r?.snippet || '').slice(0, 400)
      }))
      .filter(r => r.title || r.snippet);
  }

  return { chat, moderate, search };
}
