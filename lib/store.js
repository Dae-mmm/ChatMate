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
  return r.json();
}
// Una funzione che ritorna un record "vuoto" restituisce tutti i campi a null
const row = (r, key = 'id') => (r && r[key] ? r : null);

export const getGame = async (id) => row(await rpc('chess_get', { game_id: id }));
export const createGame = async (game) => row(await rpc('chess_create', { game }));
export const updateGame = async (id, version, patch) =>
  row(await rpc('chess_update', { game_id: id, expected_version: version, patch }));
export const listGames = async (uid) => (await rpc('chess_list_games', { uid })) || [];
export const getProfile = async (uid) => row(await rpc('chess_profile_get', { uid }), 'user_id');
export const setProfile = async (uid, patch) => row(await rpc('chess_profile_set', { uid, patch }), 'user_id');

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newId = (n = 8) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
export const newToken = () => crypto.randomBytes(18).toString('base64url');

// Livelli e pannello admin
export const ROLES = ['user', 'streamer', 'admin'];
export const getRole = async (uid) => (await rpc('chess_role_get', { uid })) || 'user';
export const adminUsers = async (q, lim, off) => (await rpc('chess_admin_users', { q: q || '', lim, off })) || [];
export const adminSetRole = (uid, role) => rpc('chess_admin_set_role', { uid, new_role: role });
export const adminGames = async (inactiveDays, lim, off) => (await rpc('chess_admin_games', { inactive_days: inactiveDays || 0, lim, off })) || [];
export const adminDeleteGames = (ids) => rpc('chess_admin_delete_games', { ids });
export const adminPurgeGames = (days) => rpc('chess_admin_purge_games', { inactive_days: days });

// Modalità Twitch
export const voteAdd = (id, round, votes) => rpc('chess_vote_add', { game_id: id, rnd: round, votes });
export const voteTally = async (id, round) => (await rpc('chess_vote_tally', { game_id: id, rnd: round })) || [];
export const liveLatest = async (key) => row(await rpc('chess_live_latest', { key }));
