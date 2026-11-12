// Pannello admin (solo account con livello "admin").
// GET  /api/admin?view=users&q=<email>&page=<n>
// GET  /api/admin?view=games&inactive=<giorni>&page=<n>
// POST /api/admin { action: "set_role", userId, role }
// POST /api/admin { action: "delete_games", ids: [...] }
// POST /api/admin { action: "purge", days }            elimina le partite ferme da più di N giorni
import { getUser, readBody } from '../lib/auth.js';
import { getRole, ROLES, adminUsers, adminSetRole, adminGames, adminDeleteGames, adminPurgeGames } from '../lib/store.js';

const PAGE = 50;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Accedi per continuare.' });
    if ((await getRole(user.id)) !== 'admin') return res.status(403).json({ error: 'Serve un account admin.' });

    if (req.method === 'GET') {
      const page = Math.max(0, parseInt(req.query.page, 10) || 0);
      if (req.query.view === 'games') {
        const days = Math.max(0, parseInt(req.query.inactive, 10) || 0);
        const rows = await adminGames(days, PAGE, page * PAGE);
        return res.status(200).json({
          total: rows[0] ? Number(rows[0].total) : 0,
          page,
          pageSize: PAGE,
          games: rows.map((g) => ({
            id: g.id,
            created: g.created_at,
            updated: g.updated_at,
            owner: g.owner_email,
            white: g.white_name || (g.white_kind === 'llm' ? 'LLM' : 'anonimo'),
            black: g.black_name || (g.black_kind === 'llm' ? 'LLM' : 'anonimo'),
            vsLlm: g.white_kind === 'llm' || g.black_kind === 'llm',
            model: g.llm_model,
            moves: g.moves,
            status: g.result ? (g.result === '1/2-1/2' ? 'patta' : g.result) : 'in corso',
          })),
        });
      }
      const rows = await adminUsers(String(req.query.q || '').trim().slice(0, 100), PAGE, page * PAGE);
      return res.status(200).json({
        page,
        pageSize: PAGE,
        me: user.id,
        users: rows.map((u) => ({
          id: u.id, email: u.email, created: u.created_at, lastSignIn: u.last_sign_in_at,
          confirmed: u.confirmed, role: u.role, hasKey: u.has_key, games: Number(u.games),
        })),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non supportato' });
    const body = readBody(req);
    if (body.action === 'set_role') {
      if (!ROLES.includes(body.role)) return res.status(400).json({ error: 'Livello non valido.' });
      if (body.userId === user.id) return res.status(400).json({ error: 'Non puoi cambiare il tuo livello da qui.' });
      if (!/^[0-9a-f-]{36}$/i.test(String(body.userId || ''))) return res.status(400).json({ error: 'Utente non valido.' });
      await adminSetRole(body.userId, body.role);
      return res.status(200).json({ ok: true, role: body.role });
    }
    if (body.action === 'delete_games') {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => /^[a-z0-9]{4,20}$/.test(x)).slice(0, 500);
      if (!ids.length) return res.status(400).json({ error: 'Nessuna partita selezionata.' });
      return res.status(200).json({ deleted: await adminDeleteGames(ids) });
    }
    if (body.action === 'purge') {
      const days = parseInt(body.days, 10);
      if (!(days >= 1)) return res.status(400).json({ error: 'Indica almeno 1 giorno.' });
      return res.status(200).json({ deleted: await adminPurgeGames(days) });
    }
    return res.status(400).json({ error: 'Azione sconosciuta.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Errore del server' });
  }
}
