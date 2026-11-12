// Azioni di gioco comuni a giocatori umani e LLM.
import { tryMove } from './chess.js';
import { getGame, updateGame } from './store.js';
import { evaluate } from './view.js';
import { AppError } from './messages.js';
const UserError = AppError;

// Calcola la modifica da salvare per un'azione, o lancia un errore leggibile.
function plan(row, color, action, input) {
  const g = evaluate(row);
  if (g.over) throw new UserError('game_over');
  const winIfOppResigns = color === 'w' ? '0-1' : '1-0';
  switch (action) {
    case 'move': {
      if (g.turn !== color) throw new UserError('not_your_turn');
      const r = tryMove(row.moves || [], input);
      if (!r.ok) throw new UserError(r.code, { move: r.input });
      // Una mossa annulla un'eventuale proposta di patta pendente dell'avversario
      const end = r.result ? { result: r.result, reason: r.reason } : {};
      // dopo un errore dell'LLM la mossa inserita a mano non ha un ragionamento: si toglie quello vecchio
      const stale = row.llm_error ? { llm_last_reasoning: null } : {};
      return { patch: { moves: r.moves, draw_offer: null, llm_error: null, ...stale, ...end }, san: r.san };
    }
    case 'resign':
      return { patch: { result: winIfOppResigns, reason: 'resign', draw_offer: null } };
    case 'offer_draw':
      if (row.draw_offer && row.draw_offer !== color) return { patch: { result: '1/2-1/2', reason: 'agreement', draw_offer: null } };
      return { patch: { draw_offer: color } };
    case 'accept_draw':
      if (!row.draw_offer || row.draw_offer === color) throw new UserError('no_draw_offer');
      return { patch: { result: '1/2-1/2', reason: 'agreement', draw_offer: null } };
    case 'decline_draw':
      return { patch: { draw_offer: null } };
    default:
      throw new UserError('unknown_action');
  }
}

// Errore mostrato all'utente: la chiave viene tradotta nella sua lingua
export { AppError as UserError };

// Applica l'azione con controllo di concorrenza (ritenta se qualcuno ha scritto nel frattempo).
export async function act(id, color, action, input, extra = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await getGame(id);
    if (!row) throw new UserError('not_found');
    const { patch, san } = plan(row, color, action, input);
    const updated = await updateGame(id, row.version, { ...patch, ...extra });
    if (updated) return { row: updated, san };
  }
  throw new UserError('conflict');
}

// Attende (long-poll) che la versione della partita cambi, fino a `seconds`.
export async function waitForChange(id, version, seconds, until = () => false) {
  const end = Date.now() + Math.min(Math.max(seconds, 0), 50) * 1000;
  let row = await getGame(id);
  while (row && row.version === version && !until(row) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 1500));
    row = await getGame(id);
  }
  return row;
}

export function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
