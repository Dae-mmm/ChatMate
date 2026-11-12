// POST /api/llm-turn { id }  fa giocare l'LLM via OpenRouter se è il suo turno.
// Chiunque guardi la partita può "svegliarlo": il server controlla turno, chiave e che non stia già pensando.
import { runLlmTurn } from '../lib/llmturn.js';
import { readBody } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  try {
    const { id } = readBody(req);
    const r = await runLlmTurn(String(id || ''));
    return res.status(200).json(r);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ status: 'error', error: 'Errore del server' });
  }
}
