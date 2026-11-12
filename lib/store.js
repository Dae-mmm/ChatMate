// Accesso al database (Supabase) tramite funzioni RPC protette dal segreto del server.
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.CHESS_SERVER_SECRET;

async function rpc(fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, ...args }),
  });
  if (!r.ok) throw new Error(`DB ${fn}: ${r.status} ${await r.text()}`);
  const row = await r.json();
  // Una funzione che ritorna un record "vuoto" restituisce tutti i campi a null
  return row && row.id ? row : null;
}

export const getGame = (id) => rpc('chess_get', { game_id: id });
export const createGame = (game) => rpc('chess_create', { game });
export const updateGame = (id, version, patch) =>
  rpc('chess_update', { game_id: id, expected_version: version, patch });

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newId = (n = 8) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
export const newToken = () => crypto.randomBytes(18).toString('base64url');
