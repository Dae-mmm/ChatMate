// Turno automatico dell'LLM via OpenRouter, con la chiave del proprietario della partita.
import { getGame, updateGame, getProfile, addLlmMove } from './store.js';
import { evaluate, llmColorOf, isDuel, modelOf, llmPrompt, extractMove, isThinking } from './view.js';
import { tryMove } from './chess.js';
import { decrypt } from './auth.js';
import { chat, OpenRouterError } from './openrouter.js';

const MAX_ATTEMPTS = 3;
const SYSTEM = 'You are a chess player. You receive the current position and the full list of your legal moves. ' +
  'Think about the position, then pick exactly one move from the list. ' +
  'End your answer with the chosen move alone, written exactly as in the list (SAN notation).';

// Ritorna { status: 'played'|'not_needed'|'busy'|'manual'|'error', ... }
export async function runLlmTurn(id) {
  let row = await getGame(id);
  if (!row) return { status: 'error', error: 'not_found' };
  const g = evaluate(row);
  const color = isDuel(row) ? g.turn : llmColorOf(row);
  if (!color || g.over || g.turn !== color) return { status: 'not_needed' };
  const model = modelOf(row, color);
  if (!model || !row.owner_id) return { status: 'manual' };
  if (isThinking(row)) return { status: 'busy' };

  const profile = await getProfile(row.owner_id);
  if (!profile?.openrouter_key_enc) {
    await updateGame(row.id, row.version, { llm_error: 'llm_no_key' });
    return { status: 'manual' };
  }

  // "Prenota" il turno: se un'altra richiesta l'ha già preso, la versione non combacia e ci fermiamo.
  const locked = await updateGame(row.id, row.version, { llm_thinking_at: new Date().toISOString(), llm_error: null });
  if (!locked) return { status: 'busy' };
  row = locked;

  // Salva l'esito. Se intanto la partita è cambiata per altro (impostazioni, voti, ecc.) ma la posizione
  // è la stessa, riprova sulla versione nuova; se invece la posizione è cambiata, la risposta non vale più.
  const startMoves = (row.moves || []).join(' ');
  // Spesa di questo turno (tutte le chiamate, anche quelle con mosse non valide), sommata a quella del colore
  const costCol = color === 'w' ? 'llm_cost_w' : 'llm_cost_b';
  let spent = 0;
  const finishWith = async (patch) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cost = spent ? { [costCol]: Number(row[costCol] || 0) + spent } : {};
      const saved = await updateGame(row.id, row.version, { llm_thinking_at: null, ...cost, ...patch });
      if (saved) return saved;
      const fresh = await getGame(row.id);
      if (!fresh || fresh.result || (fresh.moves || []).join(' ') !== startMoves) return null;
      row = fresh;
    }
    return null;
  };

  let key;
  try { key = decrypt(profile.openrouter_key_enc); }
  catch { await finishWith({ llm_error: 'llm_key_unreadable' }); return { status: 'error' }; }

  const prompt = llmPrompt(row, color, null, null, { chat: true });
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt.text }];
  let lastReply = '', lastReasoning = '';
  // il ragionamento può essere lunghissimo: si tiene la parte finale, quella che porta alla mossa
  const clip = (s) => (s.length > 12000 ? '…' + s.slice(-12000) : s) || null;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { content: reply, reasoning, cost } = await chat(key, model, messages, { reasoning: profile.llm_reasoning !== false });
      lastReply = reply; lastReasoning = reasoning; spent += cost;
      // Accettazione della patta proposta dall'avversario
      if (row.draw_offer && row.draw_offer !== color && /\bdraw\b\W*$/i.test(reply)) {
        await finishWith({ result: '1/2-1/2', reason: 'agreement', draw_offer: null, llm_last_reply: reply.slice(-1500), llm_last_reasoning: clip(reasoning) });
        return { status: 'played', move: 'draw' };
      }
      const san = extractMove(reply, prompt.legal);
      const r = tryMove(row.moves || [], san);
      if (r.ok) {
        const end = r.result ? { result: r.result, reason: r.reason } : {};
        const saved = await finishWith({ moves: r.moves, draw_offer: null, llm_last_reply: reply.slice(-1500), llm_last_reasoning: clip(reasoning), llm_error: null, ...end });
        // nel diario della partita: il diario è un extra, un errore qui non deve fermare il gioco
        if (saved) {
          await addLlmMove({ game_id: row.id, ply: r.moves.length - 1, color, model, san: r.san, reply: reply.slice(-4000),
            reasoning: reasoning ? reasoning.slice(-40000) : null, cost: spent, attempts: attempt }).catch((e) => console.error('llm log', e));
        }
        return saved ? { status: 'played', move: r.san } : { status: 'not_needed' };
      }
      messages.push({ role: 'assistant', content: reply || '(empty answer)', ...(reasoning ? { reasoning } : {}) });
      messages.push({ role: 'user', content: `"${String(san || '').slice(0, 40)}" is not one of your legal moves. Choose ONE move from this list and answer with that move only: ${prompt.legal.join(', ')}` });
    }
    await finishWith({ llm_last_reply: lastReply.slice(-1500), llm_last_reasoning: clip(lastReasoning), llm_error: `llm_invalid_moves|${MAX_ATTEMPTS}` });
    return { status: 'error' };
  } catch (e) {
    // codice (eventualmente con dettaglio) tradotto dal browser: es. "or_no_credit", "or_other|messaggio"
    const code = e instanceof OpenRouterError ? (e.detail ? `${e.code}|${e.detail}` : e.code) : 'llm_contact_error';
    if (!(e instanceof OpenRouterError)) console.error(e);
    await finishWith({ llm_error: code, ...(lastReply ? { llm_last_reply: lastReply.slice(-1500), llm_last_reasoning: clip(lastReasoning) } : {}) });
    return { status: 'error', error: code };
  }
}
