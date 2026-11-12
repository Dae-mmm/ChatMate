// Modalità Twitch. L'overlay si identifica con la chiave overlay dello streamer (sempre l'ultima partita Twitch).
// GET  /api/live?key=<chiave>                          stato della live (turno, timer, voti)
// POST /api/live { key, action: "votes", votes: [{ voter, move }] }   voti letti dalla chat
// POST /api/live { key, action: "tick" }               fa avanzare i turni (apre / chiude il voto)
// POST /api/live { key, action: "settings", channel?, voteSeconds?, graceSeconds? }  solo il proprietario (login)
import { liveLatest, updateGame } from '../lib/store.js';
import { liveView, tick, addVotes, LIMITS, clamp, cleanChannel, validChannel } from '../lib/live.js';
import { getUser, readBody } from '../lib/auth.js';

const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = req.method === 'POST' ? readBody(req) : {};
    const key = String(req.method === 'POST' ? body.key : req.query.key || '');
    if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Chiave overlay non valida.' });
    let row = await liveLatest(key);
    if (!row) return res.status(404).json({ error: 'Nessuna partita Twitch per questa chiave: creane una dal sito.' });

    if (req.method === 'GET') return res.status(200).json(await liveView(row));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non supportato' });

    if (body.action === 'votes') {
      const r = await addVotes(row, body.votes);
      return res.status(200).json(r);
    }
    if (body.action === 'tick') {
      row = await tick(row);
      return res.status(200).json(await liveView(row));
    }
    if (body.action === 'settings') {
      const user = await getUser(req);
      if (!user || user.id !== row.owner_id) return res.status(403).json({ error: 'Solo lo streamer può cambiare le impostazioni.' });
      const patch = {};
      if (body.channel != null) {
        const c = cleanChannel(body.channel);
        if (!validChannel(c)) return res.status(400).json({ error: 'Nome del canale Twitch non valido.' });
        patch.twitch_channel = c;
      }
      if (body.voteSeconds != null) patch.vote_seconds = clamp(body.voteSeconds, LIMITS.vote);
      if (body.graceSeconds != null) patch.grace_seconds = clamp(body.graceSeconds, LIMITS.grace);
      const updated = await updateGame(row.id, row.version, patch);
      if (!updated) return res.status(409).json({ error: 'La partita è appena cambiata, riprova.' });
      return res.status(200).json(await liveView(updated, { owner: true }));
    }
    return res.status(400).json({ error: 'Azione sconosciuta.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Errore del server' });
  }
}
