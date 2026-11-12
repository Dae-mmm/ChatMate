// Modalità Twitch: la chat vota la mossa, il server gestisce i turni di voto.
//
// Un turno di voto: aperto quando tocca alla chat, dura vote_seconds; poi c'è il cuscinetto
// (grace_seconds) in cui i voti arrivati in ritardo per la latenza dello stream valgono ancora.
// Alla chiusura: nessun voto -> il turno riparte; parità in testa -> spareggio solo tra le mosse
// in parità; altrimenti si gioca la mossa più votata e tocca all'LLM.
import { getGame, updateGame, voteAdd, voteTally } from './store.js';
import { evaluate, llmColorOf, isThinking, publicView } from './view.js';
import { tryMove, sqName } from './chess.js';
import { normalizeVote } from './vote.js';

export const LIMITS = { vote: [10, 300, 30], grace: [0, 20, 4] };
export const clamp = (v, [min, max, def]) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export const cleanChannel = (c) => String(c || '').trim().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').toLowerCase().slice(0, 25);
export const validChannel = (c) => /^[a-z0-9_]{3,25}$/.test(c);

const chatColorOf = (row) => { const l = llmColorOf(row); return l ? (l === 'w' ? 'b' : 'w') : null; };

function phaseOf(row, g, now = Date.now()) {
  if (g.over) return 'over';
  const chat = chatColorOf(row);
  if (g.turn !== chat) return 'llm';
  if (!row.round_ends_at) return 'idle';
  const ends = new Date(row.round_ends_at).getTime();
  if (now < ends) return 'voting';
  if (now < ends + (row.grace_seconds ?? 0) * 1000) return 'counting';
  return 'closing';
}

const openRound = (row, allowed = null) => ({
  round: (row.round || 0) + 1,
  round_ends_at: new Date(Date.now() + (row.vote_seconds || 30) * 1000).toISOString(),
  round_allowed: allowed,
});

// Fa avanzare la live: apre il turno quando tocca alla chat, lo chiude allo scadere del cuscinetto.
// È idempotente: più overlay o pannelli possono chiamarlo insieme, vince il primo (controllo di versione).
export async function tick(row) {
  const g = evaluate(row);
  const phase = phaseOf(row, g);
  if (phase === 'idle') return (await updateGame(row.id, row.version, openRound(row))) || (await getGame(row.id));
  if (phase !== 'closing') return row;

  const allowed = row.round_allowed;
  const legal = new Set(g.legalSAN.map((m) => m.replace(/[+#]+$/, '')));
  const tally = (await voteTally(row.id, row.round)).filter((t) => legal.has(t.move) && (!allowed || allowed.includes(t.move)));

  let patch;
  if (!tally.length) {
    patch = openRound(row, allowed); // nessun voto: il timer riparte (con le stesse mosse ammesse se era uno spareggio)
  } else {
    const top = Number(tally[0].votes);
    const tied = tally.filter((t) => Number(t.votes) === top).map((t) => t.move);
    if (tied.length > 1) {
      patch = openRound(row, tied); // spareggio: valgono solo le mosse in parità
    } else {
      const r = tryMove(row.moves || [], tied[0]);
      if (!r.ok) patch = openRound(row, allowed);
      else {
        patch = {
          moves: r.moves, draw_offer: null, llm_error: null,
          last_chosen: r.san, last_chosen_votes: top,
          round_ends_at: null, round_allowed: null,
          ...(r.result ? { result: r.result, reason: r.reason } : {}),
        };
      }
    }
  }
  return (await updateGame(row.id, row.version, patch)) || (await getGame(row.id));
}

// Registra i voti arrivati dalla chat. Ogni voto viene ricontrollato qui sul server.
export async function addVotes(row, votes) {
  const g = evaluate(row);
  const phase = phaseOf(row, g);
  if (phase !== 'voting' && phase !== 'counting') return { accepted: 0, reason: 'Votazione chiusa.' };
  const clean = [];
  const seen = new Set();
  for (const v of (Array.isArray(votes) ? votes : []).slice(-500).reverse()) { // l'ultimo voto di ognuno vince
    const voter = String(v?.voter || '').slice(0, 64);
    if (!voter || seen.has(voter)) continue;
    const move = normalizeVote(String(v?.move || ''), g.legalSAN, row.round_allowed);
    if (!move) continue;
    seen.add(voter);
    clean.push({ voter, move });
  }
  if (!clean.length) return { accepted: 0 };
  await voteAdd(row.id, row.round, clean);
  return { accepted: clean.length };
}

// Stato completo per overlay e pannello di controllo.
export async function liveView(row, { owner = false } = {}) {
  const g = evaluate(row);
  const phase = phaseOf(row, g);
  const chat = chatColorOf(row);
  const voting = phase === 'voting' || phase === 'counting' || phase === 'closing';
  const tally = voting ? await voteTally(row.id, row.round) : [];
  const allowed = row.round_allowed;
  const moves = voting
    ? g.legal.map((m, i) => ({ san: g.legalSAN[i].replace(/[+#]+$/, ''), from: sqName(m.from), to: sqName(m.to) }))
        .filter((m) => !allowed || allowed.includes(m.san))
    : [];
  const counts = Object.fromEntries(tally.map((t) => [t.move, Number(t.votes)]));
  const ends = row.round_ends_at ? new Date(row.round_ends_at).getTime() : null;
  const base = publicView(row, null);
  return {
    game: { ...base, legal: [] },
    gameId: row.id,
    phase,
    serverNow: Date.now(),
    chatColor: chat,
    channel: row.twitch_channel,
    voteSeconds: row.vote_seconds,
    graceSeconds: row.grace_seconds,
    round: row.round,
    endsAt: ends,
    graceEndsAt: ends ? ends + (row.grace_seconds ?? 0) * 1000 : null,
    tieBreak: !!allowed,
    moves: moves.map((m) => ({ ...m, votes: counts[m.san] || 0 })).sort((a, b) => b.votes - a.votes),
    totalVotes: tally.reduce((s, t) => s + Number(t.votes), 0),
    lastChosen: row.last_chosen ? { san: row.last_chosen, votes: row.last_chosen_votes } : null,
    llm: { model: row.llm_model, thinking: phase === 'llm' && isThinking(row), error: row.llm_error || null, lastReply: owner ? row.llm_last_reply : null },
  };
}
