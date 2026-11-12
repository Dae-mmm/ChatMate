// Trasforma una riga del database nello stato di gioco completo.
import { replay, toUCI, sqName, ascii, REASONS_IT } from './chess.js';

export function seatOf(row, token) {
  if (!token) return null;
  if (row.white_token && token === row.white_token) return 'w';
  if (row.black_token && token === row.black_token) return 'b';
  return null;
}

export function evaluate(row) {
  const g = replay(row.moves || []);
  // Abbandono o patta per accordo sono salvati nel DB; il resto si calcola dalle mosse.
  if (row.result) { g.over = true; g.result = row.result; g.reason = row.reason; }
  return g;
}

export function publicView(row, token) {
  const g = evaluate(row);
  const you = seatOf(row, token);
  const side = (c) => {
    const kind = row[`${c}_kind`];
    return { kind, name: row[`${c}_name`] || (kind === 'llm' ? 'LLM' : null), joined: kind === 'llm' || !!row[`${c}_token`] };
  };
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
    drawOffer: row.draw_offer || null,
    legal: !g.over && you === g.turn
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
export function llmPrompt(row, color, baseUrl, token) {
  const g = evaluate(row);
  const me = NAMES[color], opp = NAMES[color === 'w' ? 'b' : 'w'];
  const playUrl = `${baseUrl}/api/llm?game=${row.id}&token=${token}`;
  const head = `CHESS GAME ${row.id} - you play ${me}.`;
  const resultText = () => {
    const winner = g.result === '1-0' ? 'White wins' : g.result === '0-1' ? 'Black wins' : 'Draw';
    return `GAME OVER: ${g.result} (${winner}, ${String(g.reason).replace(/_/g, ' ')}).\nMoves: ${numbered(g.history.map((h) => h.san))}`;
  };
  if (g.over) return { status: 'over', text: `${head}\n${resultText()}` };

  if (g.turn !== color) {
    return {
      status: 'waiting',
      text: `${head}\nIt is ${opp}'s turn. Waiting for the opponent to move.\n` +
        `Check again in a few seconds: GET ${playUrl}&wait=25`,
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
    `To play it: GET ${playUrl}&move=<YOUR_MOVE>&wait=25`,
  ];
  return { status: 'your_turn', text: lines.filter((l) => l !== null).join('\n'), legal: g.legalSAN };
}
