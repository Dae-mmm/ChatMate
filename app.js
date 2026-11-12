import { sqName } from '/lib/chess.js';

const $ = (id) => document.getElementById(id);
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT = '︎'; // forza la versione "testo" dei simboli (niente emoji)

// ---------- memoria locale (token delle partite) ----------
const store = {
  all() { try { return JSON.parse(localStorage.getItem('scacchi:games') || '{}'); } catch { return {}; } },
  get(id) { return this.all()[id] || null; },
  set(id, v) { try { const a = this.all(); a[id] = { ...(a[id] || {}), ...v }; localStorage.setItem('scacchi:games', JSON.stringify(a)); } catch {} },
  name() { try { return localStorage.getItem('scacchi:name') || ''; } catch { return ''; } },
  setName(n) { try { localStorage.setItem('scacchi:name', n); } catch {} },
};

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Errore ${r.status}`);
  return data;
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiato'); }
  catch { toast('Copia non riuscita: seleziona il testo a mano'); }
}

// ---------- lobby ----------
function segValue(id) { return $(id).querySelector('.on').dataset.v; }
function initLobby() {
  $('lobby').hidden = false;
  $('name').value = store.name();
  for (const id of ['opponent', 'color']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (id === 'opponent') $('llmNameField').hidden = b.dataset.v !== 'llm';
    });
  }
  $('create').onclick = async () => {
    $('create').disabled = true; $('lobbyErr').textContent = '';
    try {
      const name = $('name').value.trim(); store.setName(name);
      const opponent = segValue('opponent');
      const r = await api('/api/games', { method: 'POST', body: JSON.stringify({
        name, opponent, color: segValue('color'), opponentName: $('llmName').value.trim(),
      }) });
      store.set(r.id, { token: r.token, llmToken: r.llmToken, color: r.color, opponent, created: Date.now() });
      location.href = `/?g=${r.id}`;
    } catch (e) { $('lobbyErr').textContent = e.message; $('create').disabled = false; }
  };
  const games = Object.entries(store.all()).sort((a, b) => (b[1].created || 0) - (a[1].created || 0)).slice(0, 10);
  if (games.length) {
    $('myGames').hidden = false;
    $('gameList').innerHTML = '';
    for (const [id, g] of games) {
      const li = document.createElement('li');
      const a = document.createElement('a'); a.href = `/?g=${id}`;
      a.textContent = `Partita ${id}`;
      const s = document.createElement('span');
      s.textContent = `${g.opponent === 'llm' ? 'vs LLM' : 'vs amico'} · ${g.color === 'w' ? 'Bianco' : g.color === 'b' ? 'Nero' : ''}`;
      a.append(s); li.append(a); $('gameList').append(li);
    }
  }
}

// ---------- partita ----------
const S = { id: null, token: null, llmToken: null, view: null, flipped: false, sel: null, pendingPromo: null, drag: null };

function parsePlacement(fen) {
  const board = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else { board['abcdefgh'[f] + (8 - r)] = ch; f++; }
    }
  });
  return board;
}

function pieceEl(p) {
  const s = document.createElement('span');
  s.className = 'pc ' + (p === p.toUpperCase() ? 'w' : 'b');
  s.textContent = GLYPH[p.toLowerCase()] + TEXT;
  return s;
}

function orientation() {
  const v = S.view;
  const base = v && v.you === 'b' ? 'b' : 'w';
  return S.flipped ? (base === 'w' ? 'b' : 'w') : base;
}

function renderBoard() {
  const v = S.view; const el = $('board'); el.innerHTML = '';
  const pos = parsePlacement(v.fen);
  const pov = orientation();
  const targets = S.sel ? v.legal.filter((m) => m.from === S.sel).map((m) => m.to) : [];
  const kingInCheck = v.check ? Object.keys(pos).find((k) => pos[k] === (v.turn === 'w' ? 'K' : 'k')) : null;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = pov === 'w' ? 7 - row : row, f = pov === 'w' ? col : 7 - col;
      const name = sqName(r * 8 + f);
      const d = document.createElement('div');
      d.className = 'sq ' + ((r + f) % 2 ? 'l' : 'd');
      d.dataset.sq = name;
      if (v.lastMove && (v.lastMove.from === name || v.lastMove.to === name)) d.classList.add('last');
      if (S.sel === name) d.classList.add('sel');
      if (kingInCheck === name) d.classList.add('check');
      if (targets.includes(name)) d.classList.add('target', ...(pos[name] || (v.legal.find((m) => m.to === name && m.from === S.sel)?.san.includes('x')) ? ['cap'] : []));
      if (v.legal.some((m) => m.from === name)) d.classList.add('mine');
      if (col === 0) { const c = document.createElement('span'); c.className = 'coord r'; c.textContent = r + 1; d.append(c); }
      if (row === 7) { const c = document.createElement('span'); c.className = 'coord f'; c.textContent = 'abcdefgh'[f]; d.append(c); }
      if (pos[name]) { const p = pieceEl(pos[name]); d.append(p); if (S.drag && S.drag.from === name) d.classList.add('ghost'); }
      el.append(d);
    }
  }
}

function playerLine(color) {
  const v = S.view; const p = color === 'w' ? v.white : v.black;
  const wrap = document.createDocumentFragment();
  const dot = document.createElement('span'); dot.className = 'dot ' + color;
  const name = document.createElement('span'); name.className = 'name';
  name.textContent = p.name || (p.joined ? (color === 'w' ? 'Bianco' : 'Nero') : 'In attesa di un giocatore…');
  wrap.append(dot, name);
  if (p.kind === 'llm') { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'LLM'; wrap.append(t); }
  if (v.you === color) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'tu'; wrap.append(t); }
  return wrap;
}

function render() {
  const v = S.view; if (!v) return;
  renderBoard();
  const pov = orientation();
  const top = pov === 'w' ? 'b' : 'w', bottom = pov;
  for (const [el, c] of [[$('pTop'), top], [$('pBottom'), bottom]]) {
    el.innerHTML = ''; el.append(playerLine(c)); el.classList.toggle('turn', !v.over && v.turn === c);
  }
  // stato
  const who = (c) => { const p = c === 'w' ? v.white : v.black; return p.name || (c === 'w' ? 'il Bianco' : 'il Nero'); };
  let status;
  const oppColor = v.you === 'w' ? 'b' : 'w';
  const oppSide = v.you ? (oppColor === 'w' ? v.white : v.black) : null;
  if (v.over) {
    const win = v.result === '1-0' ? 'Vince il Bianco' : v.result === '0-1' ? 'Vince il Nero' : 'Patta';
    status = `<b>Partita finita.</b> ${win} (${v.reasonIt}).`;
  } else if (v.you && oppSide && !oppSide.joined) {
    status = 'In attesa che il tuo amico apra il link di invito…';
  } else if (v.you && v.turn === v.you) {
    status = `<b>Tocca a te.</b>${v.check ? ' Sei sotto scacco!' : ''}`;
  } else if (v.you) {
    status = oppSide.kind === 'llm' ? `In attesa della mossa di ${escapeHtml(who(v.turn))} (LLM)…` : `Tocca a ${escapeHtml(who(v.turn))}…`;
    if (v.check) status += ' Scacco!';
  } else {
    status = `Stai guardando la partita. Tocca a ${escapeHtml(who(v.turn))}.`;
  }
  $('status').innerHTML = status;
  document.title = (!v.over && v.you && v.turn === v.you ? '● Tocca a te · ' : '') + 'ChatMate';
  $('drawBar').hidden = !(v.drawOffer && v.you && v.drawOffer !== v.you && !v.over);
  // mosse
  const ol = $('moves'); ol.innerHTML = '';
  for (let i = 0; i < v.moves.length; i += 2) {
    const li = document.createElement('li');
    for (const j of [i, i + 1]) {
      if (v.moves[j] == null) continue;
      const s = document.createElement('span'); s.textContent = v.moves[j];
      if (j === v.moves.length - 1) s.classList.add('cur');
      li.append(s);
    }
    ol.append(li);
  }
  ol.scrollTop = ol.scrollHeight;
  // pannelli
  const freeHuman = [v.white, v.black].some((p) => p.kind === 'human' && !p.joined);
  $('inviteCard').hidden = !(v.you && freeHuman);
  $('inviteUrl').value = `${location.origin}/?g=${v.id}`;
  $('llmCard').hidden = !(S.llmToken && !v.over);
  $('llmUrl').value = `${location.origin}/api/llm?game=${v.id}&token=${S.llmToken}`;
  $('actions').hidden = !v.you;
  $('offerDraw').disabled = $('resign').disabled = v.over;
  $('offerDraw').textContent = v.drawOffer === v.you ? 'Patta proposta' : 'Proponi patta';
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send(action, extra = {}) {
  $('gameErr').textContent = '';
  try {
    const r = await api('/api/game', { method: 'POST', body: JSON.stringify({ id: S.id, token: S.token, action, ...extra }) });
    setView(r.view);
  } catch (e) { $('gameErr').textContent = e.message; }
}

function setView(v) {
  if (!v) return;
  if (S.view && v.version < S.view.version) return;
  S.view = v;
  if (S.sel && !v.legal.some((m) => m.from === S.sel)) S.sel = null;
  render();
}

function tryPlay(from, to) {
  const cands = S.view.legal.filter((m) => m.from === from && m.to === to);
  if (!cands.length) return false;
  S.sel = null;
  if (cands.length > 1) { showPromo(cands); return true; }
  playMove(cands[0]);
  return true;
}

function playMove(m) {
  // aggiornamento ottimistico: ridisegna senza mosse legali finché il server non risponde
  S.view = { ...S.view, legal: [] };
  render();
  send('move', { move: m.uci });
}

function showPromo(cands) {
  const box = $('promo'); box.innerHTML = ''; box.hidden = false;
  const white = S.view.you === 'w';
  for (const pr of ['q', 'r', 'b', 'n']) {
    const m = cands.find((c) => c.promotion === pr); if (!m) continue;
    const b = document.createElement('button'); b.append(pieceEl(white ? pr.toUpperCase() : pr));
    b.onclick = () => { box.hidden = true; playMove(m); };
    box.append(b);
  }
  box.onclick = (e) => { if (e.target === box) { box.hidden = true; render(); } };
}

// Clic e trascinamento
function sqAt(x, y) { const el = document.elementFromPoint(x, y); return el?.closest?.('.sq')?.dataset.sq || null; }
function initBoardInput() {
  const board = $('board');
  board.addEventListener('pointerdown', (e) => {
    const sq = e.target.closest('.sq')?.dataset.sq; if (!sq || !S.view) return;
    if (S.sel && S.sel !== sq && tryPlay(S.sel, sq)) return;
    if (S.view.legal.some((m) => m.from === sq)) {
      S.sel = sq;
      const pos = parsePlacement(S.view.fen);
      const ghost = pieceEl(pos[sq]); ghost.classList.add('drag');
      ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
      S.drag = { from: sq, el: ghost, moved: false, x: e.clientX, y: e.clientY };
      render(); document.body.append(ghost);
      board.setPointerCapture?.(e.pointerId);
    } else { S.sel = null; render(); }
  });
  board.addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    if (Math.hypot(e.clientX - S.drag.x, e.clientY - S.drag.y) > 4) S.drag.moved = true;
    S.drag.el.style.left = e.clientX + 'px'; S.drag.el.style.top = e.clientY + 'px';
  });
  const end = (e) => {
    if (!S.drag) return;
    const d = S.drag; S.drag = null; d.el.remove();
    const to = sqAt(e.clientX, e.clientY);
    if (d.moved && to && to !== d.from) { if (!tryPlay(d.from, to)) { S.sel = null; } }
    render();
  };
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', end);
}

async function poll() {
  for (;;) {
    try {
      const v = S.view;
      const q = `id=${S.id}&token=${encodeURIComponent(S.token || '')}` + (v ? `&since=${v.version}&wait=20` : '');
      const nv = await api(`/api/game?${q}`);
      if (!S.view || nv.version !== S.view.version) setView(nv);
      if (nv.over && !document.hidden) await new Promise((r) => setTimeout(r, 15000));
    } catch (e) { await new Promise((r) => setTimeout(r, 3000)); }
  }
}

async function initGame(id) {
  $('game').hidden = false;
  S.id = id;
  const saved = store.get(id);
  S.token = saved?.token || null;
  S.llmToken = saved?.llmToken || null;
  try {
    if (!S.token) {
      // Primo accesso da un link di invito: prova a prendere il posto libero.
      const r = await api('/api/game', { method: 'POST', body: JSON.stringify({ id, action: 'join', name: store.name() || null }) });
      if (r.token) {
        S.token = r.token;
        store.set(id, { token: r.token, color: r.view.you, opponent: 'human', created: Date.now() });
        toast(`Sei entrato con il ${r.view.you === 'w' ? 'Bianco' : 'Nero'}`);
      }
      setView(r.view);
    }
  } catch (e) { $('status').textContent = e.message; return; }
  initBoardInput();
  $('flip').onclick = () => { S.flipped = !S.flipped; render(); };
  $('resign').onclick = () => { if (confirmInline($('resign'), 'Sicuro? Clicca di nuovo')) send('resign'); };
  $('offerDraw').onclick = () => send('offer_draw');
  $('acceptDraw').onclick = () => send('accept_draw');
  $('declineDraw').onclick = () => send('decline_draw');
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy($(b.dataset.copy).value)));
  $('copyPrompt').onclick = async () => {
    try {
      const r = await fetch(`/api/llm?game=${S.id}&token=${S.llmToken}`);
      await copy(await r.text());
    } catch { toast('Impossibile ottenere il prompt'); }
  };
  $('sendAnswer').onclick = async () => {
    const ans = $('llmAnswer').value.trim(); if (!ans) return;
    $('gameErr').textContent = '';
    try {
      const r = await fetch(`/api/llm?game=${S.id}&token=${S.llmToken}&format=json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ move: ans }),
      });
      const d = await r.json();
      if (d.status === 'error') $('gameErr').textContent = d.error || d.text.split('\n')[0];
      else { $('llmAnswer').value = ''; toast(d.notice || 'Mossa inviata'); }
      const v = await api(`/api/game?id=${S.id}&token=${encodeURIComponent(S.token || '')}`); setView(v);
    } catch (e) { $('gameErr').textContent = e.message; }
  };
  poll();
}

// conferma "clicca due volte" (niente finestre di dialogo del browser)
function confirmInline(btn, msg) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = 'Abbandona'; return true; }
  btn.dataset.armed = '1'; btn.textContent = msg;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Abbandona'; }, 3000);
  return false;
}

const gid = new URLSearchParams(location.search).get('g');
if (gid) initGame(gid); else initLobby();
