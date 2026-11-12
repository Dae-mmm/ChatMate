// GET /api/models  lista curata dei modelli OpenRouter (i più recenti per ogni casa + gratuiti).
import { msg, langOf, AppError, sendError } from '../lib/messages.js';
import { curatedModels, ESTIMATE } from '../lib/openrouter.js';

export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ groups: await curatedModels(), estimate: ESTIMATE });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ groups: [], error: msg(langOf(req), 'models_unavailable'), code: 'models_unavailable' });
  }
}
