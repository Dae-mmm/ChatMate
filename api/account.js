// Account dell'utente (serve l'header Authorization: Bearer <access token di Supabase>).
// GET  /api/account                                   profilo + partite recenti
// POST /api/account { action: "set_key", key }         verifica e salva la chiave OpenRouter (cifrata)
// POST /api/account { action: "remove_key" }
// POST /api/account { action: "set_model", model }     modello predefinito
import { getUser, encrypt, readBody } from '../lib/auth.js';
import { getProfile, setProfile, listGames } from '../lib/store.js';
import { checkKey } from '../lib/openrouter.js';
import { evaluate, llmColorOf } from '../lib/view.js';

const profileView = (user, p) => ({
  email: user.email,
  hasKey: !!p?.openrouter_key_enc,
  keyLast4: p?.key_last4 || null,
  defaultModel: p?.default_model || null,
});

function gameSummary(row) {
  let status = 'in corso', moves = 0;
  try {
    const g = evaluate(row);
    moves = g.history.length;
    if (g.over) status = g.result === '1/2-1/2' ? 'patta' : g.result;
  } catch { status = '?'; }
  const llm = llmColorOf(row);
  return {
    id: row.id,
    created: row.created_at,
    opponent: llm ? (row[llm === 'w' ? 'white_name' : 'black_name'] || 'LLM') : 'amico',
    vsLlm: !!llm,
    model: row.llm_model || null,
    color: llm ? (llm === 'w' ? 'b' : 'w') : null,
    moves,
    status,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Accedi per continuare.' });

    if (req.method === 'GET') {
      const [p, games] = await Promise.all([getProfile(user.id), listGames(user.id)]);
      return res.status(200).json({ ...profileView(user, p), games: games.map(gameSummary) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non supportato' });

    const body = readBody(req);
    let p;
    if (body.action === 'set_key') {
      const key = String(body.key || '').trim();
      if (!/^sk-or-/.test(key)) return res.status(400).json({ error: 'Le chiavi OpenRouter iniziano con "sk-or-".' });
      try { await checkKey(key); } catch (e) { return res.status(400).json({ error: e.message }); }
      p = await setProfile(user.id, { openrouter_key_enc: encrypt(key), key_last4: key.slice(-4) });
    } else if (body.action === 'remove_key') {
      p = await setProfile(user.id, { openrouter_key_enc: null, key_last4: null });
    } else if (body.action === 'set_model') {
      const model = String(body.model || '').trim().slice(0, 120) || null;
      if (model && !/^[\w.\-]+\/[\w.:\-]+$/.test(model)) return res.status(400).json({ error: 'ID modello non valido (formato: casa/modello).' });
      p = await setProfile(user.id, { default_model: model });
    } else {
      return res.status(400).json({ error: 'Azione sconosciuta.' });
    }
    return res.status(200).json(profileView(user, p));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Errore del server' });
  }
}
