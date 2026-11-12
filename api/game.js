// GET  /api/game?id=..&token=..[&since=<version>&wait=<s>]  stato della partita (long-poll opzionale)
// POST /api/game  { id, token, action: "join"|"move"|"resign"|"offer_draw"|"accept_draw"|"decline_draw", move?, name? }
import { getGame, updateGame, newToken } from '../lib/store.js';
import { publicView, seatOf } from '../lib/view.js';
import { act, waitForChange, UserError } from '../lib/actions.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const { id, token, since, wait } = req.query;
      let row = await getGame(String(id || ''));
      if (!row) return res.status(404).json({ error: 'Partita non trovata.' });
      if (since != null && +since === row.version && wait) row = await waitForChange(row.id, row.version, +wait);
      return res.status(200).json(publicView(row, token));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non supportato' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { id, token, action } = body;
    let row = await getGame(String(id || ''));
    if (!row) return res.status(404).json({ error: 'Partita non trovata.' });

    if (action === 'join') {
      const seat = seatOf(row, token);
      if (seat) return res.status(200).json({ token, view: publicView(row, token) });
      // Prende il primo posto umano libero; altrimenti si guarda da spettatori.
      for (const c of ['white', 'black']) {
        if (row[`${c}_kind`] === 'human' && !row[`${c}_token`]) {
          const t = newToken();
          const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 30) : null;
          const updated = await updateGame(row.id, row.version, { [`${c}_token`]: t, [`${c}_name`]: name });
          if (updated) return res.status(200).json({ token: t, view: publicView(updated, t) });
          row = await getGame(row.id); // qualcuno ha preso il posto nel frattempo
        }
      }
      return res.status(200).json({ token: null, view: publicView(row, null) });
    }

    const color = seatOf(row, token);
    if (!color) return res.status(403).json({ error: 'Non sei un giocatore di questa partita.' });
    const { row: updated, san } = await act(row.id, color, action, body.move);
    return res.status(200).json({ san, view: publicView(updated, token) });
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Errore del server' });
  }
}
