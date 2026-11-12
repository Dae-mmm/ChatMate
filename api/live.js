// Modalità Twitch. L'overlay si identifica con la chiave overlay dello streamer (sempre l'ultima partita Twitch).
import { msg, langOf, AppError, sendError } from '../lib/messages.js';
// GET  /api/live?key=<chiave>                          stato della live (turno, timer, voti)
// POST /api/live { key, action: "votes", votes: [{ voter, move }] }   voti letti dalla chat
// POST /api/live { key, action: "tick" }               fa avanzare i turni (apre / chiude il voto)
// POST /api/live { key, action: "settings", channel?, voteSeconds?, graceSeconds?, autoNext?, modelMode?, modelPool? }
//      solo il proprietario (login); valgono per la partita in corso e vengono copiate nelle successive
import { liveLatest, updateGame } from '../lib/store.js';
import { liveView, tick, addVotes, LIMITS, clamp, cleanChannel, validChannel, cleanPool, MODEL_MODES } from '../lib/live.js';
import { getUser, readBody } from '../lib/auth.js';

const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = req.method === 'POST' ? readBody(req) : {};
    const key = String(req.method === 'POST' ? body.key : req.query.key || '');
    if (!KEY_RE.test(key)) return res.status(400).json({ error: msg(langOf(req), 'overlay_key_invalid'), code: 'overlay_key_invalid' });
    let row = await liveLatest(key);
    if (!row) return res.status(404).json({ error: msg(langOf(req), 'no_twitch_game'), code: 'no_twitch_game' });

    if (req.method === 'GET') return res.status(200).json(await liveView(row));
    if (req.method !== 'POST') return res.status(405).json({ error: msg(langOf(req), 'method'), code: 'method' });

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
      if (!user || user.id !== row.owner_id) return res.status(403).json({ error: msg(langOf(req), 'only_streamer_settings'), code: 'only_streamer_settings' });
      const patch = {};
      if (body.channel != null) {
        const c = cleanChannel(body.channel);
        if (!validChannel(c)) return res.status(400).json({ error: msg(langOf(req), 'channel_invalid'), code: 'channel_invalid' });
        patch.twitch_channel = c;
      }
      if (body.voteSeconds != null) patch.vote_seconds = clamp(body.voteSeconds, LIMITS.vote);
      if (body.graceSeconds != null) patch.grace_seconds = clamp(body.graceSeconds, LIMITS.grace);
      if (body.autoNext != null) patch.auto_next_seconds = clamp(body.autoNext, LIMITS.next) || null;
      if (body.modelPool != null) patch.model_pool = cleanPool(body.modelPool);
      if (body.modelMode != null) {
        if (!MODEL_MODES.includes(body.modelMode)) return res.status(400).json({ error: msg(langOf(req), 'model_mode_invalid'), code: 'model_mode_invalid' });
        const pool = patch.model_pool ?? row.model_pool ?? [];
        if (body.modelMode !== 'fixed' && pool.length < 2) return res.status(400).json({ error: msg(langOf(req), 'pool_min2'), code: 'pool_min2' });
        patch.model_mode = body.modelMode;
      }
      const updated = await updateGame(row.id, row.version, patch);
      if (!updated) return res.status(409).json({ error: msg(langOf(req), 'game_changed_retry'), code: 'game_changed_retry' });
      return res.status(200).json(await liveView(updated, { owner: true }));
    }
    return res.status(400).json({ error: msg(langOf(req), 'unknown_action'), code: 'unknown_action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: msg(langOf(req), 'server'), code: 'server' });
  }
}
