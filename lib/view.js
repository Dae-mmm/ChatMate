// Trasforma una riga del database nello stato di gioco completo, e costruisce i prompt per gli LLM.
import { replay, toUCI, sqName, ascii, REASONS_IT } from './chess.js';

export const THINKING_TTL_MS = 5 * 60 * 1000;

export function seatOf(row, token) {
  if (!token) return null;
  if (row.white_token && token === row.white_token) return 'w';
  if (row.black_token && token === row.black_token) return 'b';
  return null;
}

// Colore dell'LLM nella partita (se c'è un LLM)
export const llmColorOf = (row) => (row.white_kind === 'llm' ? 'w' : row.black_kind === 'llm' ? 'b' : null);
// Partita LLM contro LLM: entrambi i lati sono LLM; il Bianco usa llm_model, il Nero llm_model_b
export const isDuel = (row) => row.white_kind === 'llm' && row.black_kind === 'llm';
export const modelOf = (row, color) => (isDuel(row) && color === 'b' ? row.llm_model_b : row.llm_model);
const tokenOf = (row, c) => (c === 'w' ? row.white_token : row.black_token);
export const isThinking = (row) => !!row.llm_thinking_at && Date.now() - new Date(row.llm_thinking_at).getTime() < THINKING_TTL_MS;

export function evaluate(row) {
  const g = replay(row.moves || []);
  // Abbandono o patta per accordo sono salvati nel DB; il resto si calcola dalle mosse.
  if (row.result) { g.over = true; g.result = row.result; g.reason = row.reason; }
  return g;
}

export function publicView(row, token, user = null) {
  const g = evaluate(row);
  const isOwner = !!(user && row.owner_id && row.owner_id === user.id);
  const duel = isDuel(row);
  // In un duello "l'LLM" di riferimento è quello che deve muovere (a fine partita, chi ha mosso per ultimo)
  const llmColor = duel ? (g.over ? (g.history.length % 2 ? 'w' : 'b') : g.turn) : llmColorOf(row);
  // Il proprietario di una partita contro l'LLM è il giocatore umano, anche da un altro dispositivo.
  let you = seatOf(row, token);
  let ownerTokens = null;
  if (duel) {
    you = null; // in un duello si guarda soltanto
  } else if (!you && isOwner) {
    const human = llmColor ? (llmColor === 'w' ? 'b' : 'w') : null;
    if (human) { you = human; ownerTokens = { token: tokenOf(row, human), llmToken: tokenOf(row, llmColor) }; }
  } else if (isOwner && llmColor) {
    ownerTokens = { token: tokenOf(row, you), llmToken: tokenOf(row, llmColor) };
  }
  if (ownerTokens && row.mode === 'twitch') ownerTokens.liveKey = row.live_key;
  const twitch = row.mode === 'twitch';
  const side = (c) => {
    const kind = row[`${c}_kind`];
    return { kind, name: row[`${c}_name`] || (kind === 'llm' ? 'LLM' : null), joined: kind === 'llm' || !!row[`${c}_token`] };
  };

  let llm = null;
  if (llmColor) {
    const llmTurn = !g.over && g.turn === llmColor;
    const model = modelOf(row, llmColor);
    // il giocatore umano può inserire la mossa dell'LLM (in una live solo lo streamer, se l'LLM va in errore)
    const canDrive = you && you !== llmColor && (!twitch || isOwner);
    llm = {
      color: llmColor,
      model: model || null,
      mode: model ? 'auto' : 'manual',
      // duello: chiunque guardi fa avanzare la partita, il proprietario può riprovare dopo un errore
      duel,
      canRetry: duel ? isOwner : undefined,
      thinking: llmTurn && isThinking(row),
      lastReply: row.llm_last_reply || null,
      reasoning: row.llm_last_reasoning || null,
      error: row.llm_error || null,
      turn: llmTurn,
      // Per la modalità copia-incolla: prompt da copiare e mosse legali dell'LLM per il menu a tendina
      prompt: llmTurn && canDrive ? llmPrompt(row, llmColor, null, null, { chat: true }).text : null,
      legal: llmTurn && canDrive ? g.legalSAN : [],
    };
  }

  return {
    id: row.id,
    version: row.version,
    moves: g.history.map((h) => h.san),
    lastMove: g.history.length ? { from: sqName(g.history.at(-1).from), to: sqName(g.history.at(-1).to) } : null,
    fen: g.fen,
    turn: g.turn,
    check: g.check,
    over: g.over,
    result: g.result,
    reason: g.reason,
    reasonIt: g.reason ? REASONS_IT[g.reason] || g.reason : null,
    white: side('white'),
    black: side('black'),
    you,
    isOwner,
    ownerTokens,
    mode: row.mode || 'normal',
    twitch: twitch ? {
      channel: row.twitch_channel, voteSeconds: row.vote_seconds, graceSeconds: row.grace_seconds,
      autoNext: row.auto_next_seconds || 0, modelMode: row.model_mode || 'fixed', modelPool: row.model_pool || [],
    } : null,
    llm,
    drawOffer: row.draw_offer || null,
    // In una live le mosse della chat arrivano dai voti, non dalla scacchiera
    legal: !g.over && you === g.turn && !twitch
      ? g.legal.map((m, i) => ({ from: sqName(m.from), to: sqName(m.to), san: g.legalSAN[i], uci: toUCI(m), promotion: m.promotion ? m.promotion.toLowerCase() : null }))
      : [],
  };
}

const NAMES = { w: 'White', b: 'Black' };

function numbered(moves) {
  const out = [];
  for (let i = 0; i < moves.length; i += 2) out.push(`${i / 2 + 1}. ${moves[i]}${moves[i + 1] ? ' ' + moves[i + 1] : ''}`);
  return out.join(' ') || '(none yet)';
}

// Testo per l'LLM: chi ha mosso, posizione, elenco delle mosse legali, come rispondere.
// opts.chat = true: versione da incollare in chat o da mandare via OpenRouter (senza istruzioni HTTP).
export function llmPrompt(row, color, baseUrl, token, opts = {}) {
  const g = evaluate(row);
  const me = NAMES[color], opp = NAMES[color === 'w' ? 'b' : 'w'];
  const playUrl = opts.chat ? null : `${baseUrl}/api/llm?game=${row.id}&token=${token}`;
  const head = `CHESS GAME ${row.id} - you play ${me}.`;
  if (g.over) {
    const winner = g.result === '1-0' ? 'White wins' : g.result === '0-1' ? 'Black wins' : 'Draw';
    return { status: 'over', text: `${head}\nGAME OVER: ${g.result} (${winner}, ${String(g.reason).replace(/_/g, ' ')}).\nMoves: ${numbered(g.history.map((h) => h.san))}` };
  }
  if (g.turn !== color) {
    return {
      status: 'waiting',
      text: `${head}\nIt is ${opp}'s turn. Waiting for the opponent to move.` +
        (playUrl ? `\nCheck again in a few seconds: GET ${playUrl}&wait=25` : ''),
    };
  }
  const last = g.history.at(-1);
  const lines = [
    head,
    last ? `Opponent (${opp}) moved: ${last.san}` : `You move first.`,
    g.check ? `You are in CHECK.` : null,
    row.draw_offer && row.draw_offer !== color ? `The opponent offers a draw. To accept, reply with: draw` : null,
    `Move history: ${numbered(g.history.map((h) => h.san))}`,
    `Position (FEN): ${g.fen}`,
    `Board (uppercase = White, lowercase = Black, your side at the bottom):`,
    ascii(g.state, color),
    ``,
    `Your possible moves (${g.legalSAN.length}): ${g.legalSAN.join(', ')}`,
    ``,
    `Use your reasoning to choose ONE move only among the ones available, then answer with that move only, written exactly as it appears in the list, with no other text.`,
    playUrl ? `To play it: GET ${playUrl}&move=<YOUR_MOVE>&wait=25` : null,
  ];
  return { status: 'your_turn', text: lines.filter((l) => l !== null).join('\n'), legal: g.legalSAN };
}

// Dall'output di un LLM estrae la mossa: accetta anche risposte "sporche" tipo "Move: **Nf3**".
export function extractMove(raw, legal) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const cleaned = text.replace(/[*`"'“”]/g, ' ').trim();
  const tokens = cleaned.split(/[\s,;:()[\]]+/).filter(Boolean);
  const strip = (t) => t.replace(/[+#!?.]+$/g, '');
  // Preferisce l'ultima parola che corrisponde a una mossa legale (di solito la risposta finale).
  const legalSet = new Set(legal.map(strip));
  for (let i = tokens.length - 1; i >= 0; i--) if (legalSet.has(strip(tokens[i]))) return strip(tokens[i]);
  return cleaned; // lascia decidere al parser tollerante (UCI, minuscole, ecc.)
}
