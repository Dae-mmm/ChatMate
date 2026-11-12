// GET /api/config  configurazione pubblica per il browser (login con Supabase Auth).
// La chiave "anon" di Supabase è pubblica per natura: le tabelle sono chiuse e si passa solo dal server.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
}
