// Overlay per OBS: mostra la live, legge la chat Twitch (in sola lettura, senza login) e invia i voti.
import { normalizeVote } from '/lib/vote.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const KEY = qs.get('key') || '';
if (qs.get('bg') === 'transparent') document.body.classList.add('transparent');

const COLORS = ['#E8613C', '#1FB386', '#8B7FE8', '#F2A93B', '#4C9BE8'];
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT = '︎';
const PHASE_LABEL = { voting: 'Vota la mossa in chat!', counting: 'Conteggio voti…', closing: 'Conteggio voti…', idle: 'Si prepara il turno…' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = { live: null, offset: 0, ticking: false, llmKick: false, queue: new Map(), channel: null, ws: null, chatOk: false, bannerFor: null };
const now = () => Date.now() + S.offset;

// ---------- palco 16:9 scalato ----------
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  const st = $('stage');
  st.style.transform = `scale(${s})`;
  st.style.left = `${(innerWidth - 1920 * s) / 2}px`;
  st.style.top = `${(innerHeight - 1080 * s) / 2}px`;
}
addEventListener('resize', fit); fit();

// ---------- comunicazione con il sito ----------
async function post(body) {
  const r = await fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY, ...body }) });
  return r.json().catch(() => ({}));
}
function setLive(v) {
  if (!v || v.error) return;
  S.offset = v.serverNow - Date.now();
  S.live = v;
  render();
  connectChat(v.channel);
}

async function loop() {
  if (!KEY) { $('phase').textContent = 'Manca la chiave overlay nell\'indirizzo'; return; }
  for (;;) {
    try {
      const r = await fetch(`/api/live?key=${encodeURIComponent(KEY)}`);
      const v = await r.json();
      if (!r.ok) { $('phase').textContent = v.error || 'Errore'; await sleep(5000); continue; }
      setLive(v);
      await drive();
    } catch { /* rete assente: riprova */ }
    await sleep(1000);
  }
}

// Fa avanzare la live: apre/chiude i turni di voto e sveglia l'LLM quando tocca a lui.
async function drive() {
  const v = S.live; if (!v) return;
  const due = v.phase === 'idle' || v.phase === 'closing'
    || (v.graceEndsAt && now() >= v.graceEndsAt && ['voting', 'counting'].includes(v.phase))
    || (v.phase === 'next' && (!v.next.at || now() >= v.next.graceEndsAt));
  if (due && !S.ticking) {
    S.ticking = true;
    try { await flushVotes(); setLive(await post({ action: 'tick' })); } finally { S.ticking = false; }
  }
  if (v.phase === 'llm' && !v.llm.thinking && !v.llm.error && !S.llmKick) {
    S.llmKick = true;
    fetch('/api/llm-turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.gameId }) })
      .catch(() => {}).finally(() => { S.llmKick = false; });
  }
}

// ---------- chat Twitch (IRC su WebSocket, anonimo in sola lettura) ----------
function connectChat(channel) {
  if (!channel || channel === S.channel) return;
  S.channel = channel;
  if (S.ws) { try { S.ws.close(); } catch {} }
  let retry = 1000;
  const open = () => {
    if (S.channel !== channel) return;
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    S.ws = ws;
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue; }
        if (/ JOIN #/.test(line) || / 366 /.test(line)) { S.chatOk = true; retry = 1000; renderChatState(); }
        const m = line.match(/^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/);
        if (m) onChat(m[1], m[2], m[3]);
      }
    };
    ws.onclose = () => {
      S.chatOk = false; renderChatState();
      if (S.channel === channel) { setTimeout(open, retry); retry = Math.min(retry * 2, 30000); }
    };
  };
  open();
}

function onChat(rawTags, login, text) {
  const v = S.live;
  if (!v) return;
  const tags = Object.fromEntries((rawTags || '').split(';').map((kv) => kv.split('=')));
  if (v.phase === 'next') {
    if (v.next.mode !== 'vote' || !v.next.at || now() > v.next.graceEndsAt) return;
    const n = text.trim();
    if (v.next.options.some((o) => o.n === n)) S.queue.set(tags['user-id'] || login, n);
    return;
  }
  if (v.phase !== 'voting' && v.phase !== 'counting') return;
  const move = normalizeVote(text, v.moves.map((m) => m.san));
  if (!move) return;
  S.queue.set(tags['user-id'] || login, move); // vale l'ultimo voto di ognuno
}

async function flushVotes() {
  if (!S.queue.size) return;
  const votes = [...S.queue].map(([voter, move]) => ({ voter, move }));
  S.queue.clear();
  try { await post({ action: 'votes', votes }); } catch {}
}
setInterval(flushVotes, 800);

// ---------- disegno ----------
function parsePlacement(fen) {
  const b = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { b['abcdefgh'[f] + (8 - r)] = ch; f++; } }
  });
  return b;
}
const fileIdx = (sq) => sq.charCodeAt(0) - 97, rankIdx = (sq) => +sq[1] - 1;

function renderBoard(g, pov) {
  const pos = parsePlacement(g.fen);
  const king = g.check ? Object.keys(pos).find((k) => pos[k] === (g.turn === 'w' ? 'K' : 'k')) : null;
  const el = $('board'); el.innerHTML = '';
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const r = pov === 'w' ? 7 - row : row, f = pov === 'w' ? col : 7 - col;
    const name = 'abcdefgh'[f] + (r + 1);
    const d = document.createElement('div');
    d.className = 'sq ' + ((r + f) % 2 ? 'l' : 'd');
    if (g.lastMove && (g.lastMove.from === name || g.lastMove.to === name)) d.classList.add('last');
    if (king === name) d.classList.add('check');
    if (col === 0) d.insertAdjacentHTML('beforeend', `<span class="coord r">${r + 1}</span>`);
    if (row === 7) d.insertAdjacentHTML('beforeend', `<span class="coord f">${'abcdefgh'[f]}</span>`);
    if (pos[name]) {
      const p = document.createElement('span');
      p.className = 'pc ' + (pos[name] === pos[name].toUpperCase() ? 'w' : 'b');
      p.textContent = GLYPH[pos[name].toLowerCase()] + TEXT;
      d.append(p);
    }
    el.append(d);
  }
}

function renderArrows(top, total, pov) {
  const svg = $('arrows'); svg.innerHTML = '';
  const c = (sq) => {
    const f = pov === 'w' ? fileIdx(sq) : 7 - fileIdx(sq), r = pov === 'w' ? 7 - rankIdx(sq) : rankIdx(sq);
    return [f * 100 + 50, r * 100 + 50];
  };
  // dalla meno votata alla più votata, così la più votata sta sopra
  [...top].reverse().forEach((m) => {
    const i = top.indexOf(m);
    const [x1, y1] = c(m.from), [x2, y2] = c(m.to);
    const share = total ? m.votes / total : 0;
    const w = 10 + 22 * share, head = w * 1.9;
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const ex = x2 - ux * head * 0.9, ey = y2 - uy * head * 0.9;
    const px = -uy, py = ux;
    const col = COLORS[i];
    svg.insertAdjacentHTML('beforeend',
      `<g opacity="0.82"><line x1="${x1 + ux * 22}" y1="${y1 + uy * 22}" x2="${ex}" y2="${ey}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>` +
      `<polygon points="${x2},${y2} ${ex + px * head * 0.75},${ey + py * head * 0.75} ${ex - px * head * 0.75},${ey - py * head * 0.75}" fill="${col}"/></g>`);
  });
}

function playerEl(el, side, color, turn, kind) {
  el.innerHTML = '';
  el.classList.toggle('turn', turn);
  el.insertAdjacentHTML('beforeend', `<span class="dot ${color}"></span>`);
  const n = document.createElement('span'); n.className = 'n'; n.textContent = side.name || ''; el.append(n);
  el.insertAdjacentHTML('beforeend', `<span class="tag">${kind}</span>`);
}

const RESULT = { '1-0': 'Vince il Bianco', '0-1': 'Vince il Nero', '1/2-1/2': 'Patta' };

function render() {
  const v = S.live, g = v.game;
  const pov = v.chatColor;
  const llmColor = pov === 'w' ? 'b' : 'w';
  renderBoard(g, pov);
  const chatSide = pov === 'w' ? g.white : g.black, llmSide = pov === 'w' ? g.black : g.white;
  playerEl($('plChat'), chatSide, pov, !g.over && g.turn === pov, 'chat');
  playerEl($('plLlm'), llmSide, llmColor, !g.over && g.turn === llmColor, 'LLM');

  const voting = ['voting', 'counting', 'closing', 'idle'].includes(v.phase);
  const top = voting ? v.moves.filter((m) => m.votes > 0).slice(0, 5) : [];
  renderArrows(top, v.totalVotes, pov);

  // top 5 (con posti vuoti se ci sono pochi voti) e tutte le altre mosse su 3 colonne
  const T = $('top'); T.innerHTML = '';
  const rest = $('rest'); rest.innerHTML = '';
  rest.hidden = !voting; $('hist').hidden = voting || v.phase === 'next';
  $('how').innerHTML = v.phase === 'next' && v.next.mode === 'vote'
    ? `Scrivi in chat <b>solo il numero</b> del modello, es. <code>1</code>`
    : 'Scrivi in chat <b>solo la mossa</b> in notazione inglese, es. <code>Nf6</code> · <code>exd5</code> · <code>O-O</code>';
  $('legend').hidden = v.phase === 'next';
  if (v.phase === 'next') renderNext(v, T);
  else if (voting) {
    top.forEach((m, i) => {
      const pct = v.totalVotes ? Math.round((m.votes / v.totalVotes) * 100) : 0;
      T.insertAdjacentHTML('beforeend', `<div class="row"><span class="chip" style="background:${COLORS[i]}"></span><span class="mv">${m.san}</span><div class="track"><div class="fill" style="width:${pct}%;background:${COLORS[i]}"></div></div><span class="pct">${pct}% <small>· ${m.votes}</small></span></div>`);
    });
    if (!top.length) T.insertAdjacentHTML('beforeend', '<div class="row hint">Nessun voto ancora: scrivi la tua mossa in chat!</div>');
    const others = v.moves.filter((x) => !top.includes(x));
    rest.classList.remove('c4');
    if (others.length) rest.insertAdjacentHTML('beforeend', `<span class="title">${top.length ? 'Altre mosse possibili' : 'Mosse possibili'}</span>`);
    for (const m of others) {
      const s = document.createElement('span'); if (m.votes) s.className = 'has';
      s.innerHTML = `<span>${m.san}</span><span>${m.votes || ''}</span>`;
      rest.append(s);
    }
    fitRest(rest);
  } else {
    // mentre l'LLM pensa (o a fine partita) si mostrano le ultime mosse
    const H = $('hist'); H.innerHTML = '';
    const mv = g.moves, start = Math.max(0, mv.length - 24 + (mv.length % 2 ? 1 : 0));
    for (let i = start - (start % 2); i < mv.length; i += 2) {
      H.insertAdjacentHTML('beforeend', `<span class="n">${i / 2 + 1}.</span><span class="${i === mv.length - 1 ? 'cur' : ''}">${mv[i]}</span><span class="${i + 1 === mv.length - 1 ? 'cur' : ''}">${mv[i + 1] || ''}</span>`);
    }
  }
  const full = Math.ceil(g.moves.length / 2);
  $('votes').textContent = v.phase === 'next' && v.next.mode === 'vote' ? `${v.next.totalVotes} ${v.next.totalVotes === 1 ? 'voto' : 'voti'}`
    : voting ? `${v.totalVotes} ${v.totalVotes === 1 ? 'voto' : 'voti'} · turno ${v.round}` : `mossa ${full}`;

  // fase, sottotitolo e banner sulla scacchiera
  let phase = PHASE_LABEL[v.phase] || '', sub = '';
  if (v.tieBreak && voting) { phase = 'Spareggio!'; sub = `Si vota solo tra: <b>${v.moves.map((m) => m.san).join(', ')}</b>`; }
  else if (v.phase === 'voting') sub = `Tocca alla chat (${pov === 'w' ? 'Bianco' : 'Nero'}). Ogni spettatore ha un voto, vale l'ultimo.`;
  else if (v.phase === 'counting' || v.phase === 'closing') sub = 'Ancora un attimo: contiamo i voti arrivati con il ritardo dello stream.';
  if (v.phase === 'llm') {
    phase = v.llm.error ? 'L\'LLM ha un problema' : `${llmSide.name} sta pensando…`;
    sub = v.llm.error ? 'Lo streamer sta intervenendo.' : v.lastChosen ? `La chat ha giocato <b>${v.lastChosen.san}</b> con ${v.lastChosen.votes} ${v.lastChosen.votes === 1 ? 'voto' : 'voti'}.` : '';
  }
  if (v.phase === 'over') { phase = `${RESULT[g.result] || 'Partita finita'}`; sub = g.reasonIt ? `Per ${g.reasonIt}.` : ''; }
  if (v.phase === 'next') {
    const n = v.next, nextChat = pov === 'w' ? 'Nero' : 'Bianco';
    const res = `${RESULT[g.result] || 'Partita finita'}${g.reasonIt ? ` (${g.reasonIt})` : ''}.`;
    if (n.mode === 'vote') { phase = n.tieBreak ? 'Spareggio!' : 'Scegli il prossimo avversario!'; sub = `${res} Nella prossima la chat gioca col ${nextChat}.`; }
    else if (n.mode === 'random') { phase = 'Prossima partita'; sub = `${res} Avversario estratto a caso · la chat gioca col ${nextChat}.`; }
    else { phase = 'Prossima partita'; sub = `${res} Si rigioca contro <b>${n.current}</b> · la chat gioca col ${nextChat}.`; }
  }
  $('phase').textContent = phase;
  $('sub').innerHTML = sub;

  // banner breve con la mossa appena scelta dalla chat
  const bannerKey = v.lastChosen ? `${v.gameId}:${g.moves.length}` : null;
  if (v.phase === 'llm' && v.lastChosen && S.bannerFor !== bannerKey) {
    S.bannerFor = bannerKey;
    const b = $('banner');
    b.innerHTML = `La chat gioca ${v.lastChosen.san}<small>${v.lastChosen.votes} ${v.lastChosen.votes === 1 ? 'voto' : 'voti'}</small>`;
    b.hidden = false; clearTimeout(S.bannerT); S.bannerT = setTimeout(() => (b.hidden = true), 2600);
  }
  if (v.phase === 'over' || v.phase === 'next') { const b = $('banner'); b.innerHTML = `${RESULT[g.result] || 'Fine'}<small>${g.reasonIt || ''}</small>`; b.hidden = false; }
  else if (v.phase !== 'llm') $('banner').hidden = true;
}

// Prossima partita: modelli votabili (con barre) oppure elenco dei modelli in gara
function renderNext(v, T) {
  const n = v.next;
  if (n.mode === 'vote') {
    n.options.forEach((o) => {
      const i = +o.n - 1, col = COLORS[i % COLORS.length];
      const pct = n.totalVotes ? Math.round((o.votes / n.totalVotes) * 100) : 0;
      T.insertAdjacentHTML('beforeend', `<div class="row model"><span class="num" style="background:${col}">${o.n}</span><span class="mv"></span><div class="track"><div class="fill" style="width:${pct}%;background:${col}"></div></div><span class="pct">${pct}% <small>· ${o.votes}</small></span></div>`);
      T.lastElementChild.querySelector('.mv').textContent = o.name;
    });
  } else {
    const list = n.mode === 'random' ? n.pool : [n.current];
    for (const name of list) {
      T.insertAdjacentHTML('beforeend', '<div class="row model plain"><span class="mv"></span></div>');
      T.lastElementChild.querySelector('.mv').textContent = name;
    }
  }
}

// Adatta la tabella delle altre mosse allo spazio: prima più colonne, poi testo più piccolo
function fitRest(el) {
  const top = $('top');
  for (const compact of [false, true]) { // ultima risorsa: top 5 più compatta
    top.classList.toggle('compact', compact);
    for (const cols of [3, 4, 5]) {
      for (let size = 21; size >= 16; size--) {
        el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        el.style.fontSize = `${size}px`;
        if (el.scrollHeight <= el.clientHeight + 1) return;
      }
    }
  }
}

function renderChatState() {
  const el = $('chatState');
  el.textContent = S.chatOk ? `chat #${S.channel}` : S.channel ? `chat #${S.channel} non collegata` : '';
  el.classList.toggle('off', !S.chatOk);
}

// timer fluido, indipendente dal polling
function frame() {
  const v = S.live;
  const t = $('timer'), fill = $('barFill');
  const target = v && (v.phase === 'next' ? v.next.at : ['voting', 'counting', 'closing'].includes(v.phase) ? v.endsAt : null);
  if (target) {
    const left = Math.max(0, target - now());
    const total = v.phase === 'next' ? (v.next.tieBreak ? v.voteSeconds : v.next.seconds) : v.voteSeconds;
    const s = Math.ceil(left / 1000);
    t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    t.classList.toggle('low', s <= 5);
    const counting = left <= 0;
    fill.classList.toggle('pulse', counting);
    fill.style.width = counting ? '100%' : `${Math.min(100, (left / (total * 1000)) * 100)}%`;
  } else {
    t.textContent = ''; fill.classList.remove('pulse'); fill.style.width = '0';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
loop();
