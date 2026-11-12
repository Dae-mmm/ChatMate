// Motore di regole degli scacchi, senza dipendenze.
// Usato sia dal browser sia dalle funzioni API (ES module).
// Caselle: indice 0..63, file = i % 8 (a..h), rank = i >> 3 (0 = traversa 1).

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';

export const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
export const sqIndex = (s) => {
  if (!/^[a-h][1-8]$/.test(s)) return -1;
  return (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
};
export const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
const fileOf = (i) => i & 7;
const rankOf = (i) => i >> 3;

export function parseFEN(fen) {
  const [placement, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error('FEN non valido');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else { board[(7 - r) * 8 + f] = ch; f++; }
    }
  });
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: {
      K: castle.includes('K'), Q: castle.includes('Q'),
      k: castle.includes('k'), q: castle.includes('q'),
    },
    ep: ep && ep !== '-' ? sqIndex(ep) : null,
    halfmove: +half || 0,
    fullmove: +full || 1,
  };
}

export function toFEN(s) {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f];
      if (!p) empty++;
      else { if (empty) { out += empty; empty = 0; } out += p; }
    }
    if (empty) out += empty;
    if (r) out += '/';
  }
  const c = s.castling;
  const cs = (c.K ? 'K' : '') + (c.Q ? 'Q' : '') + (c.k ? 'k' : '') + (c.q ? 'q' : '') || '-';
  return `${out} ${s.turn} ${cs} ${s.ep != null ? sqName(s.ep) : '-'} ${s.halfmove} ${s.fullmove}`;
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const step = (i, df, dr) => {
  const f = fileOf(i) + df, r = rankOf(i) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
};

// La casa sq è attaccata da un pezzo del colore `by`?
export function isAttacked(board, sq, by) {
  const up = by === 'w';
  // pedoni
  const pr = up ? -1 : 1;
  for (const df of [-1, 1]) {
    const t = step(sq, df, pr);
    if (t >= 0 && board[t] === (up ? 'P' : 'p')) return true;
  }
  for (const [df, dr] of KNIGHT) {
    const t = step(sq, df, dr);
    if (t >= 0 && board[t] === (up ? 'N' : 'n')) return true;
  }
  for (const [df, dr] of KING) {
    const t = step(sq, df, dr);
    if (t >= 0 && board[t] === (up ? 'K' : 'k')) return true;
  }
  const slide = (dirs, pieces) => {
    for (const [df, dr] of dirs) {
      let t = step(sq, df, dr);
      while (t >= 0) {
        const p = board[t];
        if (p) {
          if (colorOf(p) === by && pieces.includes(p.toUpperCase())) return true;
          break;
        }
        t = step(t, df, dr);
      }
    }
    return false;
  };
  return slide(ROOK_DIRS, 'RQ') || slide(BISHOP_DIRS, 'BQ');
}

const kingSquare = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');
export const inCheck = (s) => isAttacked(s.board, kingSquare(s.board, s.turn), s.turn === 'w' ? 'b' : 'w');

function pseudoMoves(s) {
  const moves = [];
  const { board, turn } = s;
  const enemy = turn === 'w' ? 'b' : 'w';
  const add = (from, to, extra = {}) =>
    moves.push({ from, to, piece: board[from], captured: board[to] || null, ...extra });

  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || colorOf(p) !== turn) continue;
    const type = p.toUpperCase();

    if (type === 'P') {
      const dir = turn === 'w' ? 1 : -1;
      const startRank = turn === 'w' ? 1 : 6;
      const lastRank = turn === 'w' ? 7 : 0;
      const pushPawn = (from, to, extra = {}) => {
        if (rankOf(to) === lastRank) {
          for (const pr of 'QRBN') add(from, to, { ...extra, promotion: turn === 'w' ? pr : pr.toLowerCase() });
        } else add(from, to, extra);
      };
      const one = step(i, 0, dir);
      if (one >= 0 && !board[one]) {
        pushPawn(i, one);
        const two = step(i, 0, 2 * dir);
        if (rankOf(i) === startRank && !board[two]) add(i, two, { double: true });
      }
      for (const df of [-1, 1]) {
        const t = step(i, df, dir);
        if (t < 0) continue;
        if (board[t] && colorOf(board[t]) === enemy) pushPawn(i, t);
        else if (t === s.ep) add(i, t, { enPassant: true, captured: turn === 'w' ? 'p' : 'P' });
      }
    } else if (type === 'N' || type === 'K') {
      for (const [df, dr] of type === 'N' ? KNIGHT : KING) {
        const t = step(i, df, dr);
        if (t >= 0 && colorOf(board[t]) !== turn) add(i, t);
      }
      if (type === 'K') {
        // Arrocco: re e torre non mossi, case libere, re non sotto scacco,
        // non passa né arriva su case attaccate. La torre può essere attaccata.
        const home = turn === 'w' ? 4 : 60;
        const rk = turn === 'w' ? 'R' : 'r';
        const c = s.castling;
        if (i === home && !isAttacked(board, home, enemy)) {
          if ((turn === 'w' ? c.K : c.k) && board[home + 3] === rk && !board[home + 1] && !board[home + 2] &&
              !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy))
            add(i, home + 2, { castle: 'K' });
          if ((turn === 'w' ? c.Q : c.q) && board[home - 4] === rk && !board[home - 1] && !board[home - 2] && !board[home - 3] &&
              !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy))
            add(i, home - 2, { castle: 'Q' });
        }
      }
    } else {
      const dirs = type === 'R' ? ROOK_DIRS : type === 'B' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [df, dr] of dirs) {
        let t = step(i, df, dr);
        while (t >= 0) {
          if (!board[t]) add(i, t);
          else { if (colorOf(board[t]) === enemy) add(i, t); break; }
          t = step(t, df, dr);
        }
      }
    }
  }
  return moves;
}

export function applyMove(s, m) {
  const board = s.board.slice();
  const castling = { ...s.castling };
  const turn = s.turn;
  board[m.to] = m.promotion || board[m.from];
  board[m.from] = null;
  if (m.enPassant) board[m.to + (turn === 'w' ? -8 : 8)] = null;
  if (m.castle) {
    const home = turn === 'w' ? 4 : 60;
    if (m.castle === 'K') { board[home + 1] = board[home + 3]; board[home + 3] = null; }
    else { board[home - 1] = board[home - 4]; board[home - 4] = null; }
  }
  // diritti di arrocco
  const type = m.piece.toUpperCase();
  if (type === 'K') { if (turn === 'w') castling.K = castling.Q = false; else castling.k = castling.q = false; }
  for (const sq of [m.from, m.to]) {
    if (sq === 0) castling.Q = false;
    if (sq === 7) castling.K = false;
    if (sq === 56) castling.q = false;
    if (sq === 63) castling.k = false;
  }
  return {
    board,
    turn: turn === 'w' ? 'b' : 'w',
    castling,
    ep: m.double ? (m.from + m.to) / 2 : null,
    halfmove: type === 'P' || m.captured ? 0 : s.halfmove + 1,
    fullmove: s.fullmove + (turn === 'b' ? 1 : 0),
  };
}

export function legalMoves(s) {
  return pseudoMoves(s).filter((m) => {
    const n = applyMove(s, m);
    return !isAttacked(n.board, kingSquare(n.board, s.turn), n.turn);
  });
}

// Notazione algebrica standard (SAN), con + e #.
export function toSAN(s, m, legal = legalMoves(s)) {
  let san;
  if (m.castle) san = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const type = m.piece.toUpperCase();
    const capture = !!m.captured;
    if (type === 'P') {
      san = (capture ? FILES[fileOf(m.from)] + 'x' : '') + sqName(m.to);
      if (m.promotion) san += '=' + m.promotion.toUpperCase();
    } else {
      const rivals = legal.filter((o) => o.to === m.to && o.from !== m.from && o.piece === m.piece);
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
        const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
        if (!sameFile) dis = FILES[fileOf(m.from)];
        else if (!sameRank) dis = String(rankOf(m.from) + 1);
        else dis = sqName(m.from);
      }
      san = type + dis + (capture ? 'x' : '') + sqName(m.to);
    }
  }
  const n = applyMove(s, m);
  if (inCheck(n)) san += legalMoves(n).length ? '+' : '#';
  return san;
}

export const toUCI = (m) => sqName(m.from) + sqName(m.to) + (m.promotion ? m.promotion.toLowerCase() : '');

// Interpreta una mossa scritta in modo tollerante: SAN (Nf3, exd5, O-O, e8=Q, e8Q),
// UCI (g1f3, e7e8q), con o senza + # ! ? e "x".
export function parseMove(s, input, legal = legalMoves(s)) {
  if (!input) return null;
  let t = String(input).trim().replace(/[+#!?]/g, '').replace(/^\d+\.(\.\.)?\s*/, '');
  t = t.replace(/0/g, 'O').replace(/^o-o/i, (x) => x.toUpperCase());
  if (/^O-?O-?O$/i.test(t)) return legal.find((m) => m.castle === 'Q') || null;
  if (/^O-?O$/i.test(t)) return legal.find((m) => m.castle === 'K') || null;
  // UCI o algebrica estesa (e2e4, e2-e4, Ng1-f3, Ng1xf3, e7e8q, e7-e8=Q)
  const uci = t.match(/^[NBRQKP]?([a-h][1-8])[-x]?([a-h][1-8])=?([qrbnQRBN])?$/i);
  if (uci) {
    const from = sqIndex(uci[1].toLowerCase()), to = sqIndex(uci[2].toLowerCase());
    const cands = legal.filter((m) => m.from === from && m.to === to);
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
      const pr = (uci[3] || 'q').toLowerCase();
      return cands.find((m) => m.promotion && m.promotion.toLowerCase() === pr) || null;
    }
  }
  // SAN esatta
  const bySan = legal.map((m) => [toSAN(s, m, legal).replace(/[+#]/g, ''), m]);
  const norm = (x) => x.replace(/x/g, '').replace(/=/g, '');
  const exact = bySan.find(([san]) => san === t);
  if (exact) return exact[1];
  const loose = bySan.filter(([san]) => norm(san) === norm(t));
  if (loose.length === 1) return loose[0][1];
  // Pedone scritto con "P" davanti, es. Pe4
  if (/^P/.test(t)) return parseMove(s, t.slice(1), legal);
  // Lettera del pezzo minuscola, es. nf3, qxd5 (la "b" vale come alfiere solo se non è una presa di pedone)
  if (/^[nrqkb]/.test(t)) {
    const up = t[0].toUpperCase() + t.slice(1);
    const hit = bySan.filter(([san]) => norm(san) === norm(up));
    if (hit.length === 1) return hit[0][1];
  }
  return null;
}

function insufficientMaterial(board) {
  const pieces = [];
  board.forEach((p, i) => { if (p && p.toUpperCase() !== 'K') pieces.push([p.toUpperCase(), i]); });
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (pieces[0][0] === 'B' || pieces[0][0] === 'N')) return true;
  if (pieces.every(([t]) => t === 'B')) {
    const colors = new Set(pieces.map(([, i]) => (fileOf(i) + rankOf(i)) % 2));
    return colors.size === 1;
  }
  return false;
}

// Chiave posizione per la ripetizione: la casa en passant conta solo se la presa è davvero possibile.
function positionKey(s, legal) {
  const parts = toFEN(s).split(' ');
  if (s.ep != null && !legal.some((m) => m.enPassant)) parts[3] = '-';
  return parts.slice(0, 4).join(' ');
}

// Rigioca una partita da una lista di mosse SAN e ne calcola lo stato completo.
export function replay(sanMoves = [], startFen = START_FEN) {
  let s = parseFEN(startFen);
  let legal = legalMoves(s);
  const keys = [positionKey(s, legal)];
  const history = [];
  for (const san of sanMoves) {
    const m = parseMove(s, san, legal);
    if (!m) throw new Error(`Mossa non valida nello storico: ${san}`);
    const canon = toSAN(s, m, legal);
    history.push({ san: canon, uci: toUCI(m), from: m.from, to: m.to, color: s.turn });
    s = applyMove(s, m);
    legal = legalMoves(s);
    keys.push(positionKey(s, legal));
  }
  return finish(s, legal, keys, history);
}

function finish(s, legal, keys, history) {
  const check = inCheck(s);
  let result = null, reason = null;
  const reps = keys.filter((k) => k === keys[keys.length - 1]).length;
  if (!legal.length) {
    if (check) { result = s.turn === 'w' ? '0-1' : '1-0'; reason = 'checkmate'; }
    else { result = '1/2-1/2'; reason = 'stalemate'; }
  } else if (insufficientMaterial(s.board)) { result = '1/2-1/2'; reason = 'insufficient_material'; }
  else if (reps >= 3) { result = '1/2-1/2'; reason = 'threefold_repetition'; }
  else if (s.halfmove >= 100) { result = '1/2-1/2'; reason = 'fifty_moves'; }
  return {
    state: s,
    fen: toFEN(s),
    turn: s.turn,
    check,
    legal,
    legalSAN: legal.map((m) => toSAN(s, m, legal)),
    history,
    over: !!result,
    result,
    reason,
  };
}

// Prova ad aggiungere una mossa a una partita: ritorna la nuova lista SAN o un errore.
export function tryMove(sanMoves, input) {
  const g = replay(sanMoves);
  if (g.over) return { ok: false, error: 'La partita è finita.' };
  const m = parseMove(g.state, input, g.legal);
  if (!m) return { ok: false, error: `Mossa non legale: "${input}"` };
  const san = toSAN(g.state, m, g.legal);
  return { ok: true, san, moves: [...sanMoves, san] };
}

export const REASONS_IT = {
  checkmate: 'scacco matto',
  stalemate: 'stallo',
  insufficient_material: 'materiale insufficiente',
  threefold_repetition: 'triplice ripetizione',
  fifty_moves: 'regola delle 50 mosse',
  resign: 'abbandono',
  agreement: 'accordo',
};

// Scacchiera in ASCII, dal punto di vista del colore indicato (utile per gli LLM).
export function ascii(s, pov = 'w') {
  const lines = [];
  const ranks = pov === 'w' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = pov === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  for (const r of ranks) lines.push(`${r + 1} | ` + files.map((f) => s.board[r * 8 + f] || '.').join(' '));
  lines.push('    ' + '-'.repeat(15));
  lines.push('    ' + files.map((f) => FILES[f]).join(' '));
  return lines.join('\n');
}
