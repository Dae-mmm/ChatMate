// Integrazione con OpenRouter: catalogo modelli curato, verifica chiave, chiamata chat.
const BASE = 'https://openrouter.ai/api/v1';
const APP_HEADERS = { 'HTTP-Referer': 'https://chatmate-chess.vercel.app', 'X-Title': 'ChatMate' };

// Case produttrici mostrate nella lista curata, in quest'ordine.
const AUTHORS = [
  ['anthropic', 'Anthropic (Claude)'],
  ['openai', 'OpenAI (GPT)'],
  ['google', 'Google (Gemini)'],
  ['x-ai', 'xAI (Grok)'],
  ['deepseek', 'DeepSeek'],
  ['meta-llama', 'Meta (Llama)'],
  ['mistralai', 'Mistral'],
  ['qwen', 'Qwen'],
  ['moonshotai', 'Moonshot (Kimi)'],
  ['z-ai', 'Z.ai (GLM)'],
];
const PER_AUTHOR = 4;
const FREE_COUNT = 8;

let cache = { at: 0, data: null };

const isChatModel = (m) => {
  const a = m.architecture || {};
  const out = a.output_modalities || (a.modality ? [a.modality.split('->')[1]] : ['text']);
  const inp = a.input_modalities || ['text'];
  return out.length === 1 && out[0] === 'text' && inp.includes('text') && !/embed|tts|whisper|moderation|guard/i.test(m.id);
};

// Stima dei costi. Misurati sui prompt reali di ChatMate: da ~800 caratteri in apertura a ~1.400
// alla mossa 60 (circa 30-35 mosse legali a centro partita), più le istruzioni di sistema:
// in media ~500 token in ingresso per mossa. In uscita: una risposta breve (~150 token) per i modelli
// normali, molto di più per i modelli "reasoning", che pagano anche il ragionamento nascosto.
export const ESTIMATE = {
  inputTokens: 500,
  outputTokens: 150,
  reasoningOutputTokens: 2000,
  retryFactor: 1.1, // ~10% di tentativi extra per mosse non valide
  movesPerGame: [45, 60], // mosse dell'LLM in una partita
};

export function estimateCost(m) {
  const pin = parseFloat(m.pricing?.prompt), pout = parseFloat(m.pricing?.completion);
  if (!Number.isFinite(pin) || !Number.isFinite(pout)) return null;
  const reasoning = (m.supported_parameters || []).includes('reasoning');
  const out = reasoning ? ESTIMATE.reasoningOutputTokens : ESTIMATE.outputTokens;
  const perMove = (ESTIMATE.inputTokens * pin + out * pout) * ESTIMATE.retryFactor;
  return {
    reasoning,
    perMove,
    perGame: ESTIMATE.movesPerGame.map((n) => perMove * n),
  };
}

export async function curatedModels() {
  if (cache.data && Date.now() - cache.at < 3600_000) return cache.data;
  const r = await fetch(`${BASE}/models`, { headers: APP_HEADERS });
  if (!r.ok) throw new Error(`OpenRouter models: ${r.status}`);
  const all = ((await r.json()).data || []).filter(isChatModel);
  const byNewest = (a, b) => (b.created || 0) - (a.created || 0);
  const pick = (m) => ({ id: m.id, name: m.name || m.id, cost: estimateCost(m) });
  const groups = [];
  for (const [author, label] of AUTHORS) {
    const list = all.filter((m) => m.id.startsWith(author + '/') && !m.id.endsWith(':free')).sort(byNewest).slice(0, PER_AUTHOR);
    if (list.length) groups.push({ label, models: list.map(pick) });
  }
  const free = all.filter((m) => m.id.endsWith(':free')).sort(byNewest).slice(0, FREE_COUNT);
  if (free.length) groups.push({ label: 'Gratuiti', models: free.map(pick) });
  cache = { at: Date.now(), data: groups };
  return groups;
}

// Controlla che la chiave sia valida; ritorna i dati della chiave o lancia un errore leggibile.
export async function checkKey(key) {
  const r = await fetch(`${BASE}/key`, { headers: { Authorization: `Bearer ${key}`, ...APP_HEADERS } });
  if (r.status === 401 || r.status === 403) throw new Error('Chiave OpenRouter non valida.');
  if (!r.ok) throw new Error(`OpenRouter non risponde (${r.status}), riprova.`);
  return (await r.json()).data || {};
}

export class OpenRouterError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Chiamata chat. Ritorna il testo della risposta.
export async function chat(key, model, messages, { timeoutMs = 240_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...APP_HEADERS },
      body: JSON.stringify({ model, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      const status = r.status || data.error?.code;
      const msg = data.error?.message || `errore ${status}`;
      if (status === 401) throw new OpenRouterError('La chiave OpenRouter non è più valida.', status);
      if (status === 402) throw new OpenRouterError('Credito OpenRouter esaurito.', status);
      if (status === 429) throw new OpenRouterError('Troppe richieste a OpenRouter, riprova tra poco.', status);
      throw new OpenRouterError(`OpenRouter: ${msg}`, status);
    }
    const choice = data.choices?.[0]?.message || {};
    return String(choice.content || '').trim();
  } catch (e) {
    if (e.name === 'AbortError') throw new OpenRouterError('Il modello ci ha messo troppo a rispondere.', 408);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
