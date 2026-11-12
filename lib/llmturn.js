// Turno automatico dell'LLM via OpenRouter, con la chiave del proprietario della partita.
import { getGame, updateGame, getProfile } from './store.js';
import { evaluate, llmColorOf, llmPrompt, extractMove, isThinking } from './view.js';
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
  if (!row) return { status: 'error', error: 'Partita non trovata.' };
  const color = llmColorOf(row);
  const g = evaluate(row);
  if (!color || g.over || g.turn !== color) return { status: 'not_needed' };
  if (!row.llm_model || !row.owner_id) return { status: 'manual' };
  if (isThinking(row)) return { status: 'busy' };

  const profile = await getProfile(row.owner_id);
  if (!profile?.openrouter_key_enc) {
    await updateGame(row.id, row.version, { llm_error: 'Nessuna chiave OpenRouter collegata: inserisci la mossa a mano.' });
    return { status: 'manual' };
  }

  // "Prenota" il turno: se un'altra richiesta l'ha già preso, la versione non combacia e ci fermiamo.
  const locked = await updateGame(row.id, row.version, { llm_thinking_at: new Date().toISOString(), llm_error: null });
  if (!locked) return { status: 'busy' };
  row = locked;

  const finishWith = (patch) => updateGame(row.id, row.version, { llm_thinking_at: null, ...patch });

  let key;
  try { key = decrypt(profile.openrouter_key_enc); }
  catch { await finishWith({ llm_error: 'Chiave salvata non leggibile: ricollegala dal tuo account.' }); return { status: 'error' }; }

  const prompt = llmPrompt(row, color, null, null, { chat: true });
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt.text }];
  let lastReply = '';
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const reply = await chat(key, row.llm_model, messages);
      lastReply = reply;
      // Accettazione della patta proposta dall'avversario
      if (row.draw_offer && row.draw_offer !== color && /\bdraw\b\W*$/i.test(reply)) {
        await finishWith({ result: '1/2-1/2', reason: 'agreement', draw_offer: null, llm_last_reply: reply.slice(-1500) });
        return { status: 'played', move: 'draw' };
      }
      const san = extractMove(reply, prompt.legal);
      const r = tryMove(row.moves || [], san);
      if (r.ok) {
        const saved = await finishWith({ moves: r.moves, draw_offer: null, llm_last_reply: reply.slice(-1500), llm_error: null });
        return saved ? { status: 'played', move: r.san } : { status: 'not_needed' };
      }
      messages.push({ role: 'assistant', content: reply || '(empty answer)' });
      messages.push({ role: 'user', content: `"${String(san || '').slice(0, 40)}" is not one of your legal moves. Choose ONE move from this list and answer with that move only: ${prompt.legal.join(', ')}` });
    }
    await finishWith({ llm_last_reply: lastReply.slice(-1500), llm_error: `Il modello non ha dato una mossa valida dopo ${MAX_ATTEMPTS} tentativi: inseriscila a mano o riprova.` });
    return { status: 'error' };
  } catch (e) {
    const msg = e instanceof OpenRouterError ? e.message : 'Errore nel contattare il modello.';
    if (!(e instanceof OpenRouterError)) console.error(e);
    await finishWith({ llm_error: `${msg} Puoi inserire la mossa a mano o riprovare.`, ...(lastReply ? { llm_last_reply: lastReply.slice(-1500) } : {}) });
    return { status: 'error', error: msg };
  }
}
