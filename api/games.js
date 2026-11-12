// POST /api/games  { color: "w"|"b"|"random", opponent: "human"|"llm", name?, opponentName?, model? }
import { msg, langOf, AppError, sendError } from '../lib/messages.js';
// Crea una partita. Se l'utente è collegato, la partita è sua; contro un LLM, con una chiave OpenRouter
// salvata e un modello scelto, l'LLM gioca da solo, altrimenti si usa la modalità copia-incolla.
import { createGame, newId, newToken, getProfile, setProfile, getRole } from '../lib/store.js';
import { LIMITS, clamp, cleanChannel, validChannel, createLiveGame, cleanPool, MODEL_MODES } from '../lib/live.js';
import { baseUrl } from '../lib/actions.js';
import { getUser, readBody } from '../lib/auth.js';

const MODEL_RE = /^[\w.\-]+\/[\w.:\-]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: msg(langOf(req), 'method'), code: 'method' });
  try {
    const body = readBody(req);
    const user = await getUser(req);
    if (body.opponent === 'twitch') return await createTwitchGame(req, res, body, user);
    if (body.opponent === 'duel') return await createDuel(req, res, body, user);
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
    res.status(500).json({ error: msg(langOf(req), 'server'), code: 'server' });
  }
}

// LLM contro LLM: solo admin, con la chiave OpenRouter dell'admin; si guarda e basta.
async function createDuel(req, res, body, user) {
  if (!user) return res.status(401).json({ error: msg(langOf(req), 'login_required'), code: 'login_required' });
  if ((await getRole(user.id)) !== 'admin') return res.status(403).json({ error: msg(langOf(req), 'admin_required'), code: 'admin_required' });
  const p = await getProfile(user.id);
  if (!p?.openrouter_key_enc) return res.status(400).json({ error: msg(langOf(req), 'duel_needs_key'), code: 'duel_needs_key' });
  const pick = (m) => (typeof m === 'string' && MODEL_RE.test(m.trim()) ? m.trim().slice(0, 120) : null);
  const white = pick(body.modelWhite), black = pick(body.modelBlack);
  if (!white || !black) return res.status(400).json({ error: msg(langOf(req), 'duel_pick_models'), code: 'duel_pick_models' });
  const short = (m) => m.split('/')[1].replace(/:free$/, '');
  const id = newId();
  await createGame({
    id, owner_id: user.id,
    llm_model: white, llm_model_b: black,
    white_kind: 'llm', black_kind: 'llm',
    white_name: short(white), black_name: short(black),
  });
  return res.status(200).json({ id });
}

// Partita Twitch: la chat di un canale vota le mosse contro l'LLM. Solo streamer e admin, con chiave OpenRouter.
async function createTwitchGame(req, res, body, user) {
  if (!user) return res.status(401).json({ error: msg(langOf(req), 'login_live'), code: 'login_live' });
  const role = await getRole(user.id);
  if (role !== 'streamer' && role !== 'admin') return res.status(403).json({ error: msg(langOf(req), 'twitch_streamer_only'), code: 'twitch_streamer_only' });
  const p = await getProfile(user.id);
  if (!p?.openrouter_key_enc) return res.status(400).json({ error: msg(langOf(req), 'twitch_needs_key'), code: 'twitch_needs_key' });
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 120) : p.default_model;
  if (!model || !MODEL_RE.test(model)) return res.status(400).json({ error: msg(langOf(req), 'twitch_pick_model'), code: 'twitch_pick_model' });
  const channel = cleanChannel(body.channel);
  if (!validChannel(channel)) return res.status(400).json({ error: msg(langOf(req), 'channel_required'), code: 'channel_required' });

  // Chiave overlay fissa per lo streamer: l'indirizzo in OBS non cambia tra una partita e l'altra
  let liveKey = p.live_key;
  if (!liveKey) { liveKey = newToken(); await setProfile(user.id, { live_key: liveKey }); }

  const chat = body.color === 'w' || body.color === 'b' ? body.color : Math.random() < 0.5 ? 'w' : 'b';
  const modelMode = MODEL_MODES.includes(body.modelMode) ? body.modelMode : 'fixed';
  const modelPool = cleanPool(body.modelPool);
  if (modelMode !== 'fixed' && modelPool.length < 2) return res.status(400).json({ error: msg(langOf(req), 'pool_min2'), code: 'pool_min2' });
  const { id, token, llmToken } = await createLiveGame({
    ownerId: user.id, liveKey, channel, model, chatColor: chat,
    voteSeconds: clamp(body.voteSeconds, LIMITS.vote), graceSeconds: clamp(body.graceSeconds, LIMITS.grace),
    autoNext: clamp(body.autoNext, LIMITS.next), modelMode, modelPool,
  });
  const base = baseUrl(req);
  return res.status(200).json({ id, token, color: chat, llmToken, model, liveKey, overlayUrl: `${base}/overlay.html?key=${liveKey}` });
}
