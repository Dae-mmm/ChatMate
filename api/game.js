// GET  /api/game?id=..&token=..[&since=<version>&wait=<s>]  stato della partita (long-poll opzionale)
import { msg, langOf, AppError, sendError } from '../lib/messages.js';
// POST /api/game  { id, token, action, move?, name? }
//   action: "join" | "move" | "resign" | "offer_draw" | "accept_draw" | "decline_draw"
//           "llm_move" (il giocatore umano inserisce la mossa detta dall'LLM, modalità copia-incolla)
// L'header Authorization (facoltativo) fa riconoscere il proprietario della partita su qualsiasi dispositivo.
import { getGame, updateGame, newToken } from '../lib/store.js';
import { publicView, seatOf, llmColorOf, extractMove, evaluate } from '../lib/view.js';
import { act, waitForChange, UserError } from '../lib/actions.js';
import { getUser, readBody } from '../lib/auth.js';

// Colore del richiedente: dal token del posto, oppure dall'account se è il proprietario di una partita contro l'LLM.
function colorFor(row, token, user) {
  const seat = seatOf(row, token);
  if (seat) return seat;
  const llm = llmColorOf(row);
  if (user && row.owner_id === user.id && llm) return llm === 'w' ? 'b' : 'w';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await getUser(req);
    if (req.method === 'GET') {
      const { id, token, since, wait } = req.query;
      let row = await getGame(String(id || ''));
      if (!row) return res.status(404).json({ error: msg(langOf(req), 'not_found'), code: 'not_found' });
      if (since != null && +since === row.version && wait) row = await waitForChange(row.id, row.version, +wait);
      if (!row) return res.status(404).json({ error: msg(langOf(req), 'not_found_deleted'), code: 'not_found_deleted' });
      return res.status(200).json(publicView(row, token, user));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: msg(langOf(req), 'method'), code: 'method' });

    const body = readBody(req);
    const { id, token, action } = body;
    let row = await getGame(String(id || ''));
    if (!row) return res.status(404).json({ error: msg(langOf(req), 'not_found'), code: 'not_found' });

    if (action === 'join') {
      if (colorFor(row, token, user)) return res.status(200).json({ token, view: publicView(row, token, user) });
      // Prende il primo posto umano libero; altrimenti si guarda da spettatori.
      for (const c of ['white', 'black']) {
        if (row[`${c}_kind`] === 'human' && !row[`${c}_token`]) {
          const t = newToken();
          const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 30) : null;
          const updated = await updateGame(row.id, row.version, { [`${c}_token`]: t, [`${c}_name`]: name });
          if (updated) return res.status(200).json({ token: t, view: publicView(updated, t, user) });
          row = await getGame(row.id); // qualcuno ha preso il posto nel frattempo
        }
      }
      return res.status(200).json({ token: null, view: publicView(row, null, user) });
    }

    const color = colorFor(row, token, user);
    if (!color) return res.status(403).json({ error: msg(langOf(req), 'not_player'), code: 'not_player' });

    if (action === 'llm_move') {
      const llm = llmColorOf(row);
      if (!llm || llm === color) throw new UserError('no_llm_opponent');
      // Accetta sia la sola mossa sia la risposta completa incollata dalla chat dell'LLM
      const move = extractMove(body.move, evaluate(row).legalSAN);
      const { row: updated, san } = await act(row.id, llm, 'move', move, { llm_error: null, llm_thinking_at: null });
      return res.status(200).json({ san, view: publicView(updated, token, user) });
    }

    if (row.mode === 'twitch' && action === 'move') return res.status(400).json({ error: msg(langOf(req), 'twitch_moves_by_chat'), code: 'twitch_moves_by_chat' });
    const { row: updated, san } = await act(row.id, color, action, body.move);
    return res.status(200).json({ san, view: publicView(updated, token, user) });
  } catch (e) {
    return sendError(res, req, e);
  }
}
