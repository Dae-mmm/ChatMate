// Riconoscimento dei voti dalla chat (usato sia dall'overlay sia dal server).
// Un messaggio vale come voto solo se è ESATTAMENTE una mossa legale in notazione inglese (SAN).
// Tolleranze ammesse, perché non creano ambiguità:
//   - "+" e "#" finali facoltativi (Qxf7 = Qxf7#)
//   - 0-0 / 0-0-0 al posto di O-O / O-O-O
//   - promozione senza "=" (e8Q = e8=Q)
//   - il pezzo staccato o scritto per esteso in inglese: "N f3", "Knight f3", "Q xd5", "Queen xd5"
//     (la lettera singola va maiuscola, il nome per esteso può essere scritto in qualsiasi modo)
// Le maiuscole contano: "Bxc3" è l'alfiere, "bxc3" il pedone.
// Il resto del messaggio deve essere solo la mossa: "Knight f3 is great" non vale.

const PIECE = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };

const strip = (s) => s.replace(/[+#]+$/, '');

export function normalizeVote(text, legalSAN, allowed = null) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  if (!t || t.length > 20) return null;
  // pezzo staccato ("N f3") o per esteso ("Knight f3"): si riporta alla forma compatta
  const m = t.match(/^(king|queen|rook|bishop|knight)\s*(\S+)$/i) || t.match(/^([KQRBN])\s+(\S+)$/);
  if (m) t = (PIECE[m[1].toLowerCase()] || m[1]) + m[2];
  if (t.length > 10 || /\s/.test(t)) return null;
  t = strip(t);
  if (t === '0-0') t = 'O-O';
  else if (t === '0-0-0') t = 'O-O-O';
  else if (/^([a-h]x)?[a-h][18][QRBN]$/.test(t)) t = t.slice(0, -1) + '=' + t.slice(-1);
  const match = legalSAN.find((m) => strip(m) === t);
  if (!match) return null;
  const canon = strip(match);
  if (allowed && !allowed.map(strip).includes(canon)) return null;
  return canon;
}
