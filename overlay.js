// Overlay per OBS: mostra la live, legge la chat Twitch (in sola lettura, senza login) e invia i voti.
import { normalizeVote } from '/lib/vote.js';
import { t, useLang } from '/i18n.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const KEY = qs.get('key') || '';
if (qs.get('bg') === 'transparent') document.body.classList.add('transparent');
// L'overlay è in inglese, salvo una lingua diversa scelta nell'indirizzo (?lang=)
useLang(qs.get('lang') || 'en');
document.documentElement.lang = qs.get('lang') || 'en';
$('phase').textContent = t('ov.connecting');

const COLORS = ['#E8613C', '#1FB386', '#8B7FE8', '#F2A93B', '#4C9BE8'];
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT = '︎';
const PHASE_LABEL = { voting: 'ov.voting', counting: 'ov.counting', closing: 'ov.counting', idle: 'ov.idle' };
const votesText = (n) => (n === 1 ? t('ov.vote1') : t('ov.voteN', { n }));
const reasonText = (r) => (r ? t(`reason.${r}`) : '');
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
  if (!KEY) { $('phase').textContent = t('ov.noKey'); return; }
  for (;;) {
    try {
      const r = await fetch(`/api/live?key=${encodeURIComponent(KEY)}`);
      const v = await r.json();
      if (!r.ok) { $('phase').textContent = v.error || 'Error'; await sleep(5000); continue; }
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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function playerEl(el, side, color, turn, kind) {
  el.innerHTML = '';
  el.classList.toggle('turn', turn);
  el.insertAdjacentHTML('beforeend', `<span class="dot ${color}"></span>`);
  const n = document.createElement('span'); n.className = 'n'; n.textContent = side.name || ''; el.append(n);
  el.insertAdjacentHTML('beforeend', `<span class="tag">${kind}</span>`);
}

const resultText = (r) => ({ '1-0': t('game.whiteWins'), '0-1': t('game.blackWins'), '1/2-1/2': t('game.draw') }[r] || t('live.phase.over'));

function render() {
  const v = S.live, g = v.game;
  const pov = v.chatColor;
  const llmColor = pov === 'w' ? 'b' : 'w';
  renderBoard(g, pov);
  const chatSide = pov === 'w' ? g.white : g.black, llmSide = pov === 'w' ? g.black : g.white;
  playerEl($('plChat'), chatSide, pov, !g.over && g.turn === pov, t('ov.tagChat'));
  playerEl($('plLlm'), llmSide, llmColor, !g.over && g.turn === llmColor, 'LLM');

  const voting = ['voting', 'counting', 'closing', 'idle'].includes(v.phase);
  // ragionamento dell'ultima mossa dell'LLM (solo se attivato dallo streamer): resta visibile durante il turno
  // della chat e mentre l'LLM pensa alla mossa successiva, e scorre da solo per poterlo leggere tutto
  const th = (voting || v.phase === 'llm') && v.thought;
  $('thought').hidden = !th;
  if (th) {
    $('thoughtHead').innerHTML = t('ov.thought', { name: escapeHtml(th.model), move: escapeHtml(th.move || '') });
    const text = th.text.replace(/\n{2,}/g, '\n');
    if (SCROLL.text !== text) { SCROLL.text = text; $('thoughtText').textContent = text; resetScroll(); }
  }
  const top = voting ? v.moves.filter((m) => m.votes > 0).slice(0, 5) : [];
  renderArrows(top, v.totalVotes, pov);

  // top 5 (con posti vuoti se ci sono pochi voti) e tutte le altre mosse su 3 colonne
  const T = $('top'); T.innerHTML = '';
  const rest = $('rest'); rest.innerHTML = '';
  rest.hidden = !voting; $('hist').hidden = voting || v.phase === 'next';
  $('how').innerHTML = v.phase === 'next' && v.next.mode === 'vote'
    ? t('ov.howModel')
    : t('ov.howMove');
  $('legend').textContent = t('ov.legend');
  $('legend').hidden = v.phase === 'next';
  if (v.phase === 'next') renderNext(v, T);
  else if (voting) {
    top.forEach((m, i) => {
      const pct = v.totalVotes ? Math.round((m.votes / v.totalVotes) * 100) : 0;
      T.insertAdjacentHTML('beforeend', `<div class="row"><span class="chip" style="background:${COLORS[i]}"></span><span class="mv">${m.san}</span><div class="track"><div class="fill" style="width:${pct}%;background:${COLORS[i]}"></div></div><span class="pct">${pct}% <small>· ${m.votes}</small></span></div>`);
    });
    if (!top.length) T.insertAdjacentHTML('beforeend', `<div class="row hint">${t('ov.noVotes')}</div>`);
    const others = v.moves.filter((x) => !top.includes(x));
    rest.classList.remove('c4');
    if (others.length) rest.insertAdjacentHTML('beforeend', `<span class="title">${top.length ? t('ov.otherMoves') : t('ov.possibleMoves')}</span>`);
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
  $('votes').textContent = v.phase === 'next' && v.next.mode === 'vote' ? votesText(v.next.totalVotes)
    : voting ? t('ov.metaVotes', { votes: votesText(v.totalVotes), n: v.round }) : t('ov.moveN', { n: full });

  // fase, sottotitolo e banner sulla scacchiera
  let phase = PHASE_LABEL[v.phase] ? t(PHASE_LABEL[v.phase]) : '', sub = '';
  if (v.tieBreak && voting) { phase = t('ov.tieBreak'); sub = t('ov.tieSub', { list: v.moves.map((m) => m.san).join(', ') }); }
  else if (v.phase === 'voting') sub = t('ov.votingSub', { color: pov === 'w' ? t('common.white') : t('common.black') });
  else if (v.phase === 'counting' || v.phase === 'closing') sub = t('ov.countingSub');
  if (v.phase === 'llm') {
    phase = v.llm.error ? t('ov.llmProblem') : t('ov.llmThinking', { name: llmSide.name });
    sub = v.llm.error ? t('ov.llmProblemSub') : v.lastChosen ? t('ov.chatPlayed', { move: v.lastChosen.san, votes: votesText(v.lastChosen.votes) }) : '';
  }
  if (v.phase === 'over') { phase = resultText(g.result); sub = g.reason ? t('ov.by', { reason: reasonText(g.reason) }) : ''; }
  if (v.phase === 'next') {
    const n = v.next, color = pov === 'w' ? t('col.black') : t('col.white');
    const result = `${resultText(g.result)}${g.reason ? ` (${reasonText(g.reason)})` : ''}.`;
    if (n.mode === 'vote') { phase = n.tieBreak ? t('ov.tieBreak') : t('ov.nextVote'); sub = t('ov.nextVoteSub', { result, color }); }
    else if (n.mode === 'random') { phase = t('ov.nextTitle'); sub = t('ov.nextRandomSub', { result, color }); }
    else { phase = t('ov.nextTitle'); sub = t('ov.nextFixedSub', { result, color, name: escapeHtml(n.current) }); }
  }
  $('phase').textContent = phase;
  $('sub').innerHTML = sub;

  // banner breve con la mossa appena scelta dalla chat
  const bannerKey = v.lastChosen ? `${v.gameId}:${g.moves.length}` : null;
  if (v.phase === 'llm' && v.lastChosen && S.bannerFor !== bannerKey) {
    S.bannerFor = bannerKey;
    const b = $('banner');
    b.innerHTML = `${t('ov.banner', { move: v.lastChosen.san })}<small>${votesText(v.lastChosen.votes)}</small>`;
    b.hidden = false; clearTimeout(S.bannerT); S.bannerT = setTimeout(() => (b.hidden = true), 2600);
  }
  if (v.phase === 'over' || v.phase === 'next') { const b = $('banner'); b.innerHTML = `${resultText(g.result)}<small>${reasonText(g.reason)}</small>`; b.hidden = false; }
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
  el.textContent = S.chatOk ? t('ov.chatOn', { c: S.channel }) : S.channel ? t('ov.chatOff', { c: S.channel }) : '';
  el.classList.toggle('off', !S.chatOk);
}

// Scorrimento del ragionamento come i titoli di coda: il testo entra dal basso, sale a velocità di lettura,
// esce dall'alto e ricomincia. Riparte da capo solo quando arriva un ragionamento nuovo.
const SCROLL = { text: null, y: null, last: 0 };
const SCROLL_SPEED = 18; // pixel al secondo (circa una riga ogni 1,5 s)
function resetScroll() { SCROLL.y = null; }
function scrollThought(ts) {
  const dt = SCROLL.last ? Math.min(100, ts - SCROLL.last) : 0; SCROLL.last = ts;
  if ($('thought').hidden || !SCROLL.text) return;
  const el = $('thoughtText'), view = $('thoughtView');
  // all'inizio la prima riga è già quasi in vista, così non si aspetta a vuoto
  if (SCROLL.y == null) SCROLL.y = -view.clientHeight * 0.6;
  SCROLL.y += (SCROLL_SPEED * dt) / 1000;
  if (SCROLL.y > el.offsetHeight) SCROLL.y = -view.clientHeight; // uscito tutto: rientra dal basso
  el.style.transform = `translateY(${-SCROLL.y}px)`;
}

// timer fluido, indipendente dal polling
function frame() {
  const v = S.live;
  const tm = $('timer'), fill = $('barFill');
  const target = v && (v.phase === 'next' ? v.next.at : ['voting', 'counting', 'closing'].includes(v.phase) ? v.endsAt : null);
  if (target) {
    const left = Math.max(0, target - now());
    const total = v.phase === 'next' ? (v.next.tieBreak ? v.voteSeconds : v.next.seconds) : v.voteSeconds;
    const s = Math.ceil(left / 1000);
    tm.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    tm.classList.toggle('low', s <= 5);
    const counting = left <= 0;
    fill.classList.toggle('pulse', counting);
    fill.style.width = counting ? '100%' : `${Math.min(100, (left / (total * 1000)) * 100)}%`;
  } else {
    tm.textContent = ''; fill.classList.remove('pulse'); fill.style.width = '0';
  }
  scrollThought(performance.now());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
loop();
