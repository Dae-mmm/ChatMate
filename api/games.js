// POST /api/games  { color: "w"|"b"|"random", opponent: "human"|"llm", name?, opponentName?, model? }
// Crea una partita. Se l'utente è collegato, la partita è sua; contro un LLM, con una chiave OpenRouter
// salvata e un modello scelto, l'LLM gioca da solo, altrimenti si usa la modalità copia-incolla.
import { createGame, newId, newToken, getProfile } from '../lib/store.js';
import { baseUrl } from '../lib/actions.js';
import { getUser, readBody } from '../lib/auth.js';

const MODEL_RE = /^[\w.\-]+\/[\w.:\-]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  try {
    const body = readBody(req);
    const user = await getUser(req);
    const color = body.color === 'w' || body.color === 'b' ? body.color : Math.random() < 0.5 ? 'w' : 'b';
    const opponent = body.opponent === 'llm' ? 'llm' : 'human';
    const other = color === 'w' ? 'black' : 'white';
    const mine = color === 'w' ? 'white' : 'black';
    const token = newToken();
    const llmToken = opponent === 'llm' ? newToken() : null;
    const clean = (s, d) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 40) : d);

    // Modello per la modalità automatica: solo con account e chiave salvata.
    let model = null;
    if (opponent === 'llm' && user && body.mode !== 'manual') {
      const p = await getProfile(user.id);
      const wanted = clean(body.model, p?.default_model || null);
      if (p?.openrouter_key_enc && wanted && MODEL_RE.test(wanted)) model = wanted;
    }
    const llmName = clean(body.opponentName, model ? model.split('/')[1].replace(/:free$/, '') : 'LLM');

    const id = newId();
    await createGame({
      id,
      owner_id: user ? user.id : null,
      llm_model: model,
      [`${mine}_kind`]: 'human',
      [`${mine}_token`]: token,
      [`${mine}_name`]: clean(body.name, null),
      [`${other}_kind`]: opponent,
      [`${other}_token`]: llmToken,
      [`${other}_name`]: opponent === 'llm' ? llmName : null,
    });
    const base = baseUrl(req);
    res.status(200).json({
      id,
      token,
      color,
      llmToken,
      model,
      inviteUrl: opponent === 'human' ? `${base}/?g=${id}` : null,
      llmUrl: llmToken ? `${base}/api/llm?game=${id}&token=${llmToken}` : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore del server' });
  }
}
