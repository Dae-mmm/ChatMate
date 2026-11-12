// POST /api/games  { color: "w"|"b"|"random", opponent: "human"|"llm", name?, opponentName?, model? }
// Crea una partita. Se l'utente è collegato, la partita è sua; contro un LLM, con una chiave OpenRouter
// salvata e un modello scelto, l'LLM gioca da solo, altrimenti si usa la modalità copia-incolla.
import { createGame, newId, newToken, getProfile, setProfile, getRole } from '../lib/store.js';
import { LIMITS, clamp, cleanChannel, validChannel } from '../lib/live.js';
import { baseUrl } from '../lib/actions.js';
import { getUser, readBody } from '../lib/auth.js';

const MODEL_RE = /^[\w.\-]+\/[\w.:\-]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  try {
    const body = readBody(req);
    const user = await getUser(req);
    if (body.opponent === 'twitch') return await createTwitchGame(req, res, body, user);
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

// Partita Twitch: la chat di un canale vota le mosse contro l'LLM. Solo streamer e admin, con chiave OpenRouter.
async function createTwitchGame(req, res, body, user) {
  if (!user) return res.status(401).json({ error: 'Accedi per creare una live.' });
  const role = await getRole(user.id);
  if (role !== 'streamer' && role !== 'admin') return res.status(403).json({ error: 'La modalità Twitch è riservata agli account streamer.' });
  const p = await getProfile(user.id);
  if (!p?.openrouter_key_enc) return res.status(400).json({ error: 'Per la modalità Twitch serve una chiave OpenRouter collegata al tuo account.' });
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 120) : p.default_model;
  if (!model || !MODEL_RE.test(model)) return res.status(400).json({ error: 'Scegli il modello che giocherà contro la chat.' });
  const channel = cleanChannel(body.channel);
  if (!validChannel(channel)) return res.status(400).json({ error: 'Scrivi il nome del canale Twitch (es. ilmiocanale).' });

  // Chiave overlay fissa per lo streamer: l'indirizzo in OBS non cambia tra una partita e l'altra
  let liveKey = p.live_key;
  if (!liveKey) { liveKey = newToken(); await setProfile(user.id, { live_key: liveKey }); }

  const chat = body.color === 'w' || body.color === 'b' ? body.color : Math.random() < 0.5 ? 'w' : 'b';
  const chatSide = chat === 'w' ? 'white' : 'black', llmSide = chat === 'w' ? 'black' : 'white';
  const token = newToken(), llmToken = newToken();
  const id = newId();
  await createGame({
    id,
    owner_id: user.id,
    llm_model: model,
    mode: 'twitch',
    live_key: liveKey,
    twitch_channel: channel,
    vote_seconds: clamp(body.voteSeconds, LIMITS.vote),
    grace_seconds: clamp(body.graceSeconds, LIMITS.grace),
    [`${chatSide}_kind`]: 'human',
    [`${chatSide}_token`]: token,
    [`${chatSide}_name`]: `Chat di ${channel}`,
    [`${llmSide}_kind`]: 'llm',
    [`${llmSide}_token`]: llmToken,
    [`${llmSide}_name`]: model.split('/')[1].replace(/:free$/, ''),
  });
  const base = baseUrl(req);
  return res.status(200).json({ id, token, color: chat, llmToken, model, liveKey, overlayUrl: `${base}/overlay.html?key=${liveKey}` });
}
