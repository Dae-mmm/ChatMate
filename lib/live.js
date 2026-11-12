// Modalità Twitch: la chat vota la mossa, il server gestisce i turni di voto.
//
// Un turno di voto: aperto quando tocca alla chat, dura vote_seconds; poi c'è il cuscinetto
// (grace_seconds) in cui i voti arrivati in ritardo per la latenza dello stream valgono ancora.
// Alla chiusura: nessun voto -> il turno riparte; parità in testa -> spareggio solo tra le mosse
// in parità; altrimenti si gioca la mossa più votata e tocca all'LLM.
import { getGame, updateGame, voteAdd, voteTally, createGame, newId, newToken } from './store.js';
import { evaluate, llmColorOf, isThinking, publicView } from './view.js';
import { tryMove, sqName } from './chess.js';
import { normalizeVote } from './vote.js';

export const LIMITS = { vote: [10, 300, 30], grace: [0, 20, 4], next: [0, 600, 0] };
export const MODEL_RE = /^[\w.\-]+\/[\w.:\-]+$/;
export const MODEL_MODES = ['fixed', 'random', 'vote'];
export const MAX_POOL = 5;
export const cleanPool = (pool) => [...new Set((Array.isArray(pool) ? pool : []).map((m) => String(m).trim()).filter((m) => MODEL_RE.test(m)))].slice(0, MAX_POOL);
export const modelName = (id) => String(id || '').split('/').pop().replace(/:free$/, '');
export const clamp = (v, [min, max, def]) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export const cleanChannel = (c) => String(c || '').trim().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').toLowerCase().slice(0, 25);
export const validChannel = (c) => /^[a-z0-9_]{3,25}$/.test(c);

const chatColorOf = (row) => { const l = llmColorOf(row); return l ? (l === 'w' ? 'b' : 'w') : null; };

const autoNext = (row) => (row.auto_next_seconds || 0) > 0;

function phaseOf(row, g, now = Date.now()) {
  if (g.over) return autoNext(row) && !row.next_game_id ? 'next' : 'over';
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

// Crea una partita Twitch. La chat ha il colore indicato, l'LLM l'altro.
export async function createLiveGame(o) {
  const chatSide = o.chatColor === 'w' ? 'white' : 'black', llmSide = o.chatColor === 'w' ? 'black' : 'white';
  const id = o.id || newId(), token = newToken(), llmToken = newToken();
  await createGame({
    id,
    owner_id: o.ownerId,
    llm_model: o.model,
    mode: 'twitch',
    live_key: o.liveKey,
    twitch_channel: o.channel,
    vote_seconds: o.voteSeconds,
    grace_seconds: o.graceSeconds,
    auto_next_seconds: o.autoNext || null,
    model_mode: o.modelMode || 'fixed',
    model_pool: o.modelPool && o.modelPool.length ? o.modelPool : null,
    [`${chatSide}_kind`]: 'human',
    [`${chatSide}_token`]: token,
    [`${chatSide}_name`]: `#${o.channel}`,
    [`${llmSide}_kind`]: 'llm',
    [`${llmSide}_token`]: llmToken,
    [`${llmSide}_name`]: modelName(o.model),
  });
  return { id, token, llmToken };
}

// Modelli tra cui scegliere la prossima partita (il pool, o il modello attuale se il pool è vuoto)
const poolOf = (row) => (row.model_pool && row.model_pool.length ? row.model_pool : [row.llm_model]);
const pickRandom = (list, avoid) => {
  const choices = list.length > 1 ? list.filter((m) => m !== avoid) : list;
  return choices[Math.floor(Math.random() * choices.length)];
};

// Conto alla rovescia tra una partita e l'altra (e voto sul modello, se previsto).
async function tickNext(row) {
  const voteMode = row.model_mode === 'vote';
  if (!row.next_at) {
    const patch = {
      next_at: new Date(Date.now() + row.auto_next_seconds * 1000).toISOString(),
      round: (row.round || 0) + 1,
      round_allowed: null,
      next_models: voteMode ? poolOf(row) : null,
    };
    return (await updateGame(row.id, row.version, patch)) || (await getGame(row.id));
  }
  const ends = new Date(row.next_at).getTime() + (voteMode ? (row.grace_seconds ?? 0) * 1000 : 0);
  if (Date.now() < ends) return row;

  let model;
  if (row.model_mode === 'random') model = pickRandom(poolOf(row), row.llm_model);
  else if (voteMode) {
    const options = row.next_models && row.next_models.length ? row.next_models : poolOf(row);
    const allowed = row.round_allowed;
    const valid = (n) => /^\d$/.test(n) && +n >= 1 && +n <= options.length && (!allowed || allowed.includes(n));
    const tally = (await voteTally(row.id, row.round)).filter((t) => valid(t.move));
    if (!tally.length) {
      // nessun voto: si estrae a caso tra le opzioni in gara, così la live non si ferma
      const pool = allowed ? allowed.map((n) => options[+n - 1]) : options;
      model = pool[Math.floor(Math.random() * pool.length)];
    } else {
      const top = Number(tally[0].votes);
      const tied = tally.filter((t) => Number(t.votes) === top).map((t) => t.move);
      if (tied.length > 1) {
        // spareggio tra i modelli in parità
        const patch = { next_at: new Date(Date.now() + (row.vote_seconds || 30) * 1000).toISOString(), round: row.round + 1, round_allowed: tied };
        return (await updateGame(row.id, row.version, patch)) || (await getGame(row.id));
      }
      model = options[+tied[0] - 1];
    }
  } else model = row.llm_model;

  // Prenota la nuova partita sulla vecchia: solo chi vince la scrittura la crea davvero
  const nextId = newId();
  const reserved = await updateGame(row.id, row.version, { next_game_id: nextId, last_chosen: modelName(model) });
  if (!reserved) return (await getGame(row.id));
  const chatColor = llmColorOf(row) === 'w' ? 'w' : 'b'; // la chat passa al colore che aveva l'LLM
  await createLiveGame({
    id: nextId, ownerId: row.owner_id, liveKey: row.live_key, channel: row.twitch_channel, model, chatColor,
    voteSeconds: row.vote_seconds, graceSeconds: row.grace_seconds, autoNext: row.auto_next_seconds,
    modelMode: row.model_mode, modelPool: row.model_pool,
  });
  return reserved;
}

// Fa avanzare la live: apre il turno quando tocca alla chat, lo chiude allo scadere del cuscinetto.
// È idempotente: più overlay o pannelli possono chiamarlo insieme, vince il primo (controllo di versione).
export async function tick(row) {
  const g = evaluate(row);
  const phase = phaseOf(row, g);
  if (phase === 'next') return tickNext(row);
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
  if (phase === 'next') return addModelVotes(row, votes);
  if (phase !== 'voting' && phase !== 'counting') return { accepted: 0, reason: 'voting_closed' };
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

async function addModelVotes(row, votes) {
  if (row.model_mode !== 'vote' || !row.next_at || !row.next_models) return { accepted: 0, reason: 'no_vote_open' };
  const graceEnd = new Date(row.next_at).getTime() + (row.grace_seconds ?? 0) * 1000;
  if (Date.now() > graceEnd) return { accepted: 0, reason: 'voting_closed' };
  const n = row.next_models.length, allowed = row.round_allowed;
  const clean = [], seen = new Set();
  for (const v of (Array.isArray(votes) ? votes : []).slice(-500).reverse()) {
    const voter = String(v?.voter || '').slice(0, 64);
    const choice = String(v?.move || '').trim();
    if (!voter || seen.has(voter) || !/^\d$/.test(choice) || +choice < 1 || +choice > n) continue;
    if (allowed && !allowed.includes(choice)) continue;
    seen.add(voter); clean.push({ voter, move: choice });
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
  let next = null;
  if (phase === 'next') {
    const voteMode = row.model_mode === 'vote';
    const opts = row.next_models || [];
    const t = voteMode && row.next_at ? Object.fromEntries((await voteTally(row.id, row.round)).map((x) => [x.move, Number(x.votes)])) : {};
    const at = row.next_at ? new Date(row.next_at).getTime() : null;
    next = {
      mode: row.model_mode,
      at,
      graceEndsAt: at && voteMode ? at + (row.grace_seconds ?? 0) * 1000 : at,
      seconds: row.auto_next_seconds,
      tieBreak: !!row.round_allowed,
      current: modelName(row.llm_model),
      pool: poolOf(row).map(modelName),
      options: opts.map((id, i) => ({ n: String(i + 1), id, name: modelName(id), votes: t[String(i + 1)] || 0 }))
        .filter((o) => !row.round_allowed || row.round_allowed.includes(o.n)),
    };
    next.totalVotes = next.options.reduce((s2, o) => s2 + o.votes, 0);
  }
  return {
    next,
    autoNext: row.auto_next_seconds || 0,
    modelMode: row.model_mode || 'fixed',
    modelPool: row.model_pool || [],
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
