// POST /api/games  { color: "w"|"b"|"random", opponent: "human"|"llm", name?, opponentName? }
// Crea una partita e restituisce il token del creatore (e quello dell'LLM, se presente).
import { createGame, newId, newToken } from '../lib/store.js';
import { baseUrl } from '../lib/actions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    let color = body.color === 'w' || body.color === 'b' ? body.color : Math.random() < 0.5 ? 'w' : 'b';
    const opponent = body.opponent === 'llm' ? 'llm' : 'human';
    const other = color === 'w' ? 'black' : 'white';
    const mine = color === 'w' ? 'white' : 'black';
    const token = newToken();
    const llmToken = opponent === 'llm' ? newToken() : null;
    const clean = (s, d) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 30) : d);
    const id = newId();
    await createGame({
      id,
      [`${mine}_kind`]: 'human',
      [`${mine}_token`]: token,
      [`${mine}_name`]: clean(body.name, null),
      [`${other}_kind`]: opponent,
      [`${other}_token`]: llmToken,
      [`${other}_name`]: opponent === 'llm' ? clean(body.opponentName, 'LLM') : null,
    });
    const base = baseUrl(req);
    res.status(200).json({
      id,
      token,
      color,
      llmToken,
      inviteUrl: opponent === 'human' ? `${base}/?g=${id}` : null,
      llmUrl: llmToken ? `${base}/api/llm?game=${id}&token=${llmToken}` : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore del server' });
  }
}
