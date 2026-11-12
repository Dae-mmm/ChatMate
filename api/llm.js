// Endpoint testuale pensato per gli LLM.
//   GET  /api/llm?game=ID&token=T                 -> istruzioni + mosse possibili (se è il tuo turno)
//   GET  /api/llm?game=ID&token=T&move=Nf3        -> gioca la mossa
//   &wait=25                                      -> attende fino a 25 s che tocchi di nuovo a te
//   POST /api/llm?game=ID&token=T  body: "Nf3" (testo) oppure {"move":"Nf3"}
//   &format=json                                  -> risposta JSON invece che testo
// Mosse speciali: "resign" (abbandona), "draw" (propone o accetta la patta).
import { getGame } from '../lib/store.js';
import { seatOf, llmPrompt, evaluate } from '../lib/view.js';
import { act, waitForChange, baseUrl, UserError } from '../lib/actions.js';

// Dall'output di un LLM estrae la mossa: accetta anche risposte "sporche" tipo "Move: **Nf3**".
function extractMove(raw, legal) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const cleaned = text.replace(/[*`"'“”]/g, ' ').trim();
  const tokens = cleaned.split(/[\s,;:]+/).filter(Boolean);
  const strip = (t) => t.replace(/[+#!?.]+$/g, '');
  // Preferisce l'ultima parola che corrisponde a una mossa legale (di solito la risposta finale).
  const legalSet = new Set(legal.map(strip));
  for (let i = tokens.length - 1; i >= 0; i--) if (legalSet.has(strip(tokens[i]))) return strip(tokens[i]);
  return cleaned; // lascia decidere al parser tollerante (UCI, minuscole, ecc.)
}

function send(res, fmt, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  if (fmt === 'json') return res.status(status).json(payload);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(status).send(payload.text);
}

export default async function handler(req, res) {
  const q = req.query;
  const fmt = q.format === 'json' ? 'json' : 'text';
  try {
    const id = String(q.game || q.id || '');
    const token = String(q.token || '');
    let row = await getGame(id);
    if (!row) return send(res, fmt, 404, { status: 'error', text: `ERROR: game "${id}" not found.` });
    const color = seatOf(row, token);
    if (!color || row[color === 'w' ? 'white_kind' : 'black_kind'] !== 'llm')
      return send(res, fmt, 403, { status: 'error', text: 'ERROR: invalid token for this game.' });

    let move = q.move;
    if (req.method === 'POST') {
      const b = req.body;
      move = typeof b === 'string' ? b : b && typeof b === 'object' ? b.move ?? move : move;
    }
    const base = baseUrl(req);
    let notice = '';

    if (move != null && String(move).trim()) {
      const word = String(move).trim().toLowerCase();
      try {
        if (word === 'resign') { row = (await act(id, color, 'resign')).row; notice = 'You resigned.'; }
        else if (word === 'draw') {
          const r = await act(id, color, 'offer_draw');
          row = r.row; notice = row.result ? 'Draw accepted.' : 'Draw offered to the opponent. Keep playing: send a move if it is your turn.';
        } else {
          const g = evaluate(row);
          const san = extractMove(move, g.legalSAN);
          const r = await act(id, color, 'move', san);
          row = r.row; notice = `OK, you played ${r.san}.`;
        }
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        const p = llmPrompt(row, color, base, token);
        return send(res, fmt, 200, { status: 'error', error: e.message, text: `ERROR: ${e.message.replace('Mossa non legale', 'Illegal move').replace('Non è il tuo turno.', 'It is not your turn.').replace('La partita è finita.', 'The game is over.')}\n\n${p.text}` });
      }
    }

    // Long-poll: aspetta che sia di nuovo il turno dell'LLM (o che la partita finisca).
    const wait = +q.wait || 0;
    if (wait > 0) {
      const mine = (r) => { const g = evaluate(r); return g.over || g.turn === color; };
      if (!mine(row)) {
        let v = row.version;
        const end = Date.now() + Math.min(wait, 50) * 1000;
        while (Date.now() < end) {
          row = await waitForChange(id, v, (end - Date.now()) / 1000);
          if (mine(row) || row.version === v) break;
          v = row.version;
        }
      }
    }
    const p = llmPrompt(row, color, base, token);
    const text = (notice ? notice + '\n\n' : '') + p.text;
    return send(res, fmt, 200, { status: p.status, notice: notice || null, legal: p.legal || [], text });
  } catch (e) {
    console.error(e);
    return send(res, fmt, 500, { status: 'error', text: 'ERROR: server error, try again.' });
  }
}
