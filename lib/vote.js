// Riconoscimento dei voti dalla chat (usato sia dall'overlay sia dal server).
// Un messaggio vale come voto solo se è ESATTAMENTE una mossa legale in notazione inglese (SAN).
// Tolleranze ammesse, perché non creano ambiguità:
//   - "+" e "#" finali facoltativi (Qxf7 = Qxf7#)
//   - 0-0 / 0-0-0 al posto di O-O / O-O-O
//   - promozione senza "=" (e8Q = e8=Q)
//   - il pezzo staccato o scritto per esteso in inglese: "N f3", "Knight f3", "Q xd5", "Queen xd5"
//     (la lettera singola va maiuscola, il nome per esteso può essere scritto in qualsiasi modo)
//   - la cattura senza "x": "Queen e2" = Qxe2, "ed5" = exd5 (solo se la mossa possibile è una sola)
//   - la casa con la lettera maiuscola: "F4" = f4, "N G6" = Ng6
//   - il pedone con "pawn" o "P" (anche attaccata, "Pf4"): "Pawn e4" = e4, "Pawn exd5" = exd5, e "Pawn xd5" = la sola
//     cattura di pedone su d5 (se i pedoni che possono catturare lì sono due, il voto non vale)
// Il pezzo in minuscolo vale ("qxe2", "nf3"), ma "bxc3" resta il pedone se quella cattura esiste.
// Il resto del messaggio deve essere solo la mossa: "Knight f3 is great" non vale.

// promozione senza "=": e8Q → e8=Q
const promo = (t) => (/^([a-h]?x)?[a-h][18][QRBN]$/.test(t) ? t.slice(0, -1) + '=' + t.slice(-1) : t);

const PIECE = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };

const strip = (s) => s.replace(/[+#]+$/, '');

export function normalizeVote(text, legalSAN, allowed = null) {
  if (typeof text !== 'string') return null;
  // Twitch e alcuni client (7TV, Chatterino…) aggiungono caratteri invisibili ai messaggi ripetuti
  // per aggirare il blocco dei duplicati: si tolgono prima di leggere la mossa
  let t = String(text).replace(/[\u034F\u200B-\u200D\u2060\uFEFF\u{E0000}-\u{E007F}]/gu, '').trim();
  if (!t || t.length > 20) return null;
  // case con la lettera maiuscola ("F4", "N G6", "Queen D6"): la colonna va in minuscolo
  t = t.replace(/([A-H])([1-8])/g, (_, f, r) => f.toLowerCase() + r);
  // pezzo staccato ("N f3") o per esteso ("Knight f3"): si riporta alla forma compatta
  const pawn = t.match(/^(?:pawn\s*|p\s*)([a-h]\S*|x\S+)$/i);
  const m = !pawn && (t.match(/^(king|queen|rook|bishop|knight)\s*(\S+)$/i) || t.match(/^([KQRBN]|[kqrn])\s+(\S+)$/));
  if (m) t = (PIECE[m[1].toLowerCase()] || m[1].toUpperCase()) + m[2];
  if (pawn) {
    t = pawn[1];
    if (t.startsWith('x')) {
      // "Pawn xd5": vale solo se una sola cattura di pedone arriva lì
      const target = promo(strip(t));
      const caps = legalSAN.filter((s) => /^[a-h]x/.test(s) && strip(s).slice(1) === target);
      if (caps.length !== 1) return null;
      t = strip(caps[0]);
    }
    if (!/^[a-h]/.test(t)) return null; // dopo "pawn" deve esserci una mossa di pedone
  }
  if (t.length > 10 || /\s/.test(t)) return null;
  t = strip(t);
  if (t === '0-0' || t === 'o-o') t = 'O-O';
  else if (t === '0-0-0' || t === 'o-o-o') t = 'O-O-O';
  else t = promo(t);
  let match = legalSAN.find((m) => strip(m) === t);
  // pezzo scritto in minuscolo ("qxe2", "nf3"): vale se non è già una mossa di pedone.
  // Per la "b" conta prima il pedone: "bxc3" è il pedone se può catturare, altrimenti l'alfiere.
  if (!match && /^[kqrnb]/.test(t)) {
    const up = t[0].toUpperCase() + t.slice(1);
    match = legalSAN.find((m) => strip(m) === up);
  }
  // cattura scritta senza "x" ("Queen e2", "Qe2" quando c'è solo Qxe2, "ed5"): vale se la mossa è una sola
  if (!match) {
    const noX = (s) => s.replace('x', '');
    for (const cand of [t, t[0].toUpperCase() + t.slice(1)]) {
      const hits = legalSAN.filter((m) => m.includes('x') && noX(strip(m)) === noX(cand));
      if (hits.length === 1) { match = hits[0]; break; }
    }
  }
  if (!match) return null;
  const canon = strip(match);
  if (allowed && !allowed.map(strip).includes(canon)) return null;
  return canon;
}
