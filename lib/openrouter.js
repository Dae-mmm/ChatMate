// Integrazione con OpenRouter: catalogo modelli curato, verifica chiave, chiamata chat.
import { AppError } from './messages.js';

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
  // I modelli con ragionamento possono rispondere subito o ragionare a lungo: si dà una forbice.
  const reasoning = (m.supported_parameters || []).includes('reasoning');
  const move = (out) => (ESTIMATE.inputTokens * pin + out * pout) * ESTIMATE.retryFactor;
  const low = move(ESTIMATE.outputTokens);
  const high = reasoning ? move(ESTIMATE.reasoningOutputTokens) : low;
  const [nMin, nMax] = ESTIMATE.movesPerGame;
  return { reasoning, perMove: [low, high], perGame: [low * nMin, high * nMax] };
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
    // Niente varianti con suffisso (":batch", ":free", ...): servono risposte in tempo reale.
    const list = all.filter((m) => m.id.startsWith(author + '/') && !m.id.includes(':')).sort(byNewest).slice(0, PER_AUTHOR);
    if (list.length) groups.push({ label, models: list.map(pick) });
  }
  const free = all.filter((m) => m.id.endsWith(':free')).sort(byNewest).slice(0, FREE_COUNT);
  if (free.length) groups.push({ label: 'Free', free: true, models: free.map(pick) });
  cache = { at: Date.now(), data: groups };
  return groups;
}

// Controlla che la chiave sia valida; ritorna i dati della chiave o lancia un errore leggibile.
export async function checkKey(key) {
  const r = await fetch(`${BASE}/key`, { headers: { Authorization: `Bearer ${key}`, ...APP_HEADERS } });
  if (r.status === 401 || r.status === 403) throw new AppError('key_invalid');
  if (!r.ok) throw new AppError('openrouter_down', { status: r.status });
  return (await r.json()).data || {};
}

// code: or_key_invalid | or_no_credit | or_rate | or_timeout | or_other (detail = messaggio di OpenRouter)
export class OpenRouterError extends Error {
  constructor(code, status, detail = '') { super(code); this.code = code; this.status = status; this.detail = detail; }
}

// Testo del ragionamento restituito a parte da OpenRouter: campo "reasoning" oppure,
// se manca, i blocchi leggibili di reasoning_details (testo o riassunto; quelli cifrati si saltano).
function reasoningOf(m) {
  if (typeof m.reasoning === 'string' && m.reasoning.trim()) return m.reasoning.trim();
  const parts = (Array.isArray(m.reasoning_details) ? m.reasoning_details : [])
    .map((d) => (d?.type === 'reasoning.text' ? d.text : d?.type === 'reasoning.summary' ? d.summary : ''))
    .filter((x) => typeof x === 'string' && x.trim());
  return parts.join('\n\n').trim();
}

// Chiamata chat. Ritorna { content, reasoning } (reasoning vuoto se il modello non lo fornisce).
// reasoning: true chiede ai modelli che lo supportano di ragionare, con un budget fisso di token.
// Con "effort: low" i modelli Claude recenti spesso decidevano di non ragionare affatto (0 token di ragionamento);
// un budget esplicito attiva sempre il ragionamento. Gli altri modelli ignorano il parametro.
const REASONING_BUDGET = 1024;
export async function chat(key, model, messages, { timeoutMs = 240_000, reasoning = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...APP_HEADERS },
      body: JSON.stringify({ model, messages, ...(reasoning ? { reasoning: { max_tokens: REASONING_BUDGET } } : {}) }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      const status = r.status || data.error?.code;
      const msg = data.error?.message || `error ${status}`;
      if (status === 401) throw new OpenRouterError('or_key_invalid', status);
      if (status === 402) throw new OpenRouterError('or_no_credit', status);
      if (status === 429) throw new OpenRouterError('or_rate', status);
      throw new OpenRouterError('or_other', status, String(msg).slice(0, 200));
    }
    const choice = data.choices?.[0]?.message || {};
    const out = { content: String(choice.content || '').trim(), reasoning: reasoningOf(choice) };
    // Diagnostica (log di Vercel): il modello ha ragionato? in che forma è arrivato il ragionamento?
    console.log('[llm]', JSON.stringify({
      model, asked: !!reasoning, provider: data.provider || null,
      reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      reasoningField: typeof choice.reasoning === 'string' ? choice.reasoning.length : choice.reasoning ?? null,
      details: Array.isArray(choice.reasoning_details) ? choice.reasoning_details.map((d) => d?.type) : null,
      shown: out.reasoning.length,
    }));
    return out;
  } catch (e) {
    if (e.name === 'AbortError') throw new OpenRouterError('or_timeout', 408);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
