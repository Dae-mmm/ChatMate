import { sqName } from '/lib/chess.js';

const $ = (id) => document.getElementById(id);
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT = '︎'; // forza la versione "testo" dei simboli (niente emoji)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- memoria locale ----------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const store = {
  all() { return ls.get('scacchi:games', {}); },
  get(id) { return this.all()[id] || null; },
  set(id, v) { const a = this.all(); a[id] = { ...(a[id] || {}), ...v }; ls.set('scacchi:games', a); },
  name() { return ls.get('scacchi:name', ''); },
  setName(n) { ls.set('scacchi:name', n); },
};

// ---------- account (Supabase Auth via REST) ----------
const auth = {
  cfg: null,
  session: ls.get('chatmate:session', null),
  async config() {
    if (!this.cfg) this.cfg = await fetch('/api/config').then((r) => r.json());
    return this.cfg;
  },
  async call(path, body, token) {
    const c = await this.config();
    const r = await fetch(`${c.supabaseUrl}/auth/v1/${path}`, {
      method: body === undefined ? 'GET' : path === 'user' ? 'PUT' : 'POST',
      headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(authError(data));
    return data;
  },
  save(d) {
    this.session = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000,
      email: d.user?.email || this.session?.email || null,
    };
    ls.set('chatmate:session', this.session);
  },
  clear() { this.session = null; ls.del('chatmate:session'); },
  async token() {
    const s = this.session;
    if (!s) return null;
    if (Date.now() < s.expires_at - 60_000) return s.access_token;
    try { this.save(await this.call('token?grant_type=refresh_token', { refresh_token: s.refresh_token })); return this.session.access_token; }
    catch { this.clear(); renderNav(); return null; }
  },
  async signIn(email, password) { this.save(await this.call('token?grant_type=password', { email, password })); },
  async signUp(email, password) {
    const d = await this.call(`signup?redirect_to=${encodeURIComponent(location.origin + '/')}`, { email, password });
    if (d.access_token) { this.save(d); return 'in'; }
    return 'confirm';
  },
  async recover(email) { await this.call(`recover?redirect_to=${encodeURIComponent(location.origin + '/')}`, { email }); },
  async setPassword(password) { await this.call('user', { password }, await this.token()); },
  async signOut() { const t = this.session?.access_token; this.clear(); if (t) this.call('logout', {}, t).catch(() => {}); },
};

function authError(d) {
  const m = String(d.msg || d.error_description || d.message || d.error || '').toLowerCase();
  if (m.includes('invalid login')) return 'Email o password non corretti.';
  if (m.includes('not confirmed')) return 'Devi prima confermare l\'email: controlla la posta.';
  if (m.includes('already registered')) return 'Esiste già un account con questa email.';
  if (m.includes('password should be')) return 'La password deve avere almeno 6 caratteri.';
  if (m.includes('rate limit') || m.includes('seconds')) return 'Troppi tentativi, riprova tra qualche minuto.';
  return d.msg || d.error_description || d.message || 'Errore di accesso.';
}

// Ritorno dal link nell'email (conferma registrazione o recupero password): i token sono nell'hash dell'URL.
function consumeAuthHash() {
  if (!location.hash.includes('access_token') && !location.hash.includes('error')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error')) { toast(p.get('error_description') || 'Link non valido o scaduto.'); return null; }
  auth.save({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') });
  return p.get('type');
}

async function api(path, opts = {}) {
  const token = await auth.token();
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Errore ${r.status}`);
  return data;
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiato'); }
  catch { toast('Copia non riuscita: seleziona il testo a mano'); }
}
function segValue(id) { return $(id).querySelector('.on').dataset.v; }
function initSeg(id, onChange) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    e.preventDefault();
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange?.(b.dataset.v);
  });
}
const msg = (el, text, ok = false) => { el.textContent = text || ''; el.classList.toggle('ok', ok); };

// Profilo dell'utente collegato (livello, chiave, partite), caricato una volta per pagina
let mePromise = null;
const loadMe = () => (mePromise ||= auth.session ? api('/api/account').catch(() => null) : Promise.resolve(null));

function renderNav() {
  const s = auth.session;
  $('navUser').hidden = $('navAccount').hidden = $('navLogout').hidden = !s;
  $('navLogin').hidden = !!s;
  $('navUser').textContent = s?.email || '';
  $('navAdmin').hidden = true;
  if (s) loadMe().then((me) => { $('navAdmin').hidden = me?.role !== 'admin'; });
}

// ---------- selettore del modello (lista curata + ID libero) ----------
let modelsPromise = null;
const loadModels = () => (modelsPromise ||= fetch('/api/models').then((r) => r.json()).catch(() => ({ groups: [] })));

// Importi piccoli: due cifre significative (0,0012 $), importi normali con due decimali.
const usd = (x) => (x === 0 ? 'gratis' : x < 0.01 ? `$${x.toPrecision(2)}` : `$${x.toFixed(2)}`);
const range = ([a, b]) => (Math.abs(a - b) < 1e-9 ? `~${usd(a)}` : `${usd(a)}–${usd(b)}`);

async function modelPicker(container, initial) {
  container.innerHTML = '';
  const sel = document.createElement('select');
  const custom = document.createElement('input');
  custom.placeholder = 'ID modello, es. anthropic/claude-…';
  custom.hidden = true;
  const info = document.createElement('p'); info.className = 'hint costInfo';
  container.append(sel, custom, info);
  const { groups, estimate } = await loadModels();
  const byId = {};
  let found = false;
  for (const g of groups) {
    const og = document.createElement('optgroup'); og.label = g.label;
    for (const m of g.models) {
      byId[m.id] = m;
      const o = document.createElement('option'); o.value = m.id;
      o.textContent = m.name + (m.cost ? ` · ${m.cost.perGame[1] === 0 ? 'gratis' : `${range(m.cost.perGame)} a partita`}` : '');
      if (m.id === initial) { o.selected = true; found = true; }
      og.append(o);
    }
    sel.append(og);
  }
  const other = document.createElement('option'); other.value = '__custom'; other.textContent = 'Altro (scrivi l\'ID)…';
  sel.append(other);
  if (initial && !found) { other.selected = true; custom.hidden = false; custom.value = initial; }
  if (!groups.length) { other.selected = true; custom.hidden = false; }
  const showInfo = () => {
    const m = byId[sel.value];
    if (!m || !m.cost) { info.textContent = sel.value === '__custom' ? 'Costo non stimato per i modelli scritti a mano.' : ''; return; }
    const c = m.cost, [a, b] = estimate.movesPerGame;
    info.textContent = c.perGame[1] === 0
      ? 'Modello gratuito (con limiti di utilizzo di OpenRouter).'
      : `Stima: ${range(c.perMove)} a mossa · ${range(c.perGame)} a partita (${a}–${b} mosse dell'LLM).` +
        (c.reasoning ? ' Modello con ragionamento: il minimo è una risposta breve, il massimo un ragionamento lungo a ogni mossa.' : '');
  };
  sel.onchange = () => { custom.hidden = sel.value !== '__custom'; if (!custom.hidden) custom.focus(); showInfo(); };
  showInfo();
  return { value: () => (sel.value === '__custom' ? custom.value.trim() : sel.value) };
}

// ---------- pagina accesso ----------
function initAuth(recovery = false) {
  $('auth').hidden = false;
  let tab = 'login';
  const setTab = (t) => {
    tab = t;
    $('authSubmit').textContent = t === 'login' ? 'Accedi' : t === 'signup' ? 'Crea account' : 'Invia link di recupero';
    $('authPassField').hidden = t === 'forgot';
    $('authPass').required = t !== 'forgot';
    $('authPass').autocomplete = t === 'signup' ? 'new-password' : 'current-password';
    $('authForgot').hidden = t !== 'login';
    msg($('authMsg'), '');
  };
  initSeg('authTabs', setTab);
  $('authForgot').onclick = () => setTab('forgot');
  $('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('authEmail').value.trim(), pass = $('authPass').value;
    $('authSubmit').disabled = true; msg($('authMsg'), '');
    try {
      if (tab === 'login') { await auth.signIn(email, pass); location.href = '/'; return; }
      if (tab === 'signup') {
        const r = await auth.signUp(email, pass);
        if (r === 'in') { location.href = '/?p=account'; return; }
        msg($('authMsg'), 'Ti abbiamo mandato un\'email: apri il link per confermare l\'account.', true);
      } else {
        await auth.recover(email);
        msg($('authMsg'), 'Se l\'email è registrata, riceverai un link per scegliere una nuova password.', true);
      }
    } catch (err) { msg($('authMsg'), err.message); }
    $('authSubmit').disabled = false;
  };
  if (recovery) {
    $('authForm').hidden = true; $('authTabs').hidden = true; $('resetForm').hidden = false;
    $('resetForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await auth.setPassword($('newPass').value); toast('Password aggiornata'); location.href = '/'; }
      catch (err) { msg($('authMsg'), err.message); }
    };
  }
}

// ---------- pagina account ----------
async function initAccount() {
  if (!auth.session) { location.href = '/?p=login'; return; }
  $('account').hidden = false;
  let acc;
  const render = () => {
    $('accEmail').textContent = `Accesso come ${acc.email}`;
    $('keyStatus').innerHTML = acc.hasKey
      ? `<span class="badge ok">Collegata</span> chiave che termina con <code>…${escapeHtml(acc.keyLast4)}</code>`
      : '<span class="badge">Nessuna chiave</span> senza chiave giochi in modalità copia e incolla.';
    $('keyRemove').hidden = !acc.hasKey;
    $('keyInput').placeholder = acc.hasKey ? 'Incolla una nuova chiave per sostituirla' : 'sk-or-...';
    const ul = $('accGames'); ul.innerHTML = '';
    if (!acc.games.length) ul.innerHTML = '<li class="hint">Ancora nessuna partita.</li>';
    for (const g of acc.games) ul.append(gameItem(g.id, g.vsLlm ? `vs ${g.opponent}` : 'vs amico', `${g.moves} mosse · ${g.status}`));
  };
  acc = await loadMe();
  if (!acc) { msg($('accMsg'), 'Impossibile caricare l\'account: riprova ad accedere.'); return; }
  render();
  const picker = await modelPicker($('accModelPick'), acc.defaultModel);
  $('keySave').onclick = async () => {
    const key = $('keyInput').value.trim(); if (!key) return;
    $('keySave').disabled = true; msg($('accMsg'), 'Verifico la chiave…', true);
    try { acc = { ...acc, ...(await api('/api/account', { method: 'POST', body: JSON.stringify({ action: 'set_key', key }) })) }; $('keyInput').value = ''; render(); msg($('accMsg'), 'Chiave salvata.', true); }
    catch (e) { msg($('accMsg'), e.message); }
    $('keySave').disabled = false;
  };
  $('keyRemove').onclick = async () => {
    if (!confirmInline($('keyRemove'), 'Sicuro? Clicca di nuovo', 'Rimuovi chiave')) return;
    try { acc = { ...acc, ...(await api('/api/account', { method: 'POST', body: JSON.stringify({ action: 'remove_key' }) })) }; render(); msg($('accMsg'), 'Chiave rimossa.', true); }
    catch (e) { msg($('accMsg'), e.message); }
  };
  $('modelSave').onclick = async () => {
    try { acc = { ...acc, ...(await api('/api/account', { method: 'POST', body: JSON.stringify({ action: 'set_model', model: picker.value() }) })) }; msg($('accMsg'), 'Modello salvato.', true); }
    catch (e) { msg($('accMsg'), e.message); }
  };
}

function gameItem(id, title, sub) {
  const li = document.createElement('li');
  const a = document.createElement('a'); a.href = `/?g=${id}`; a.textContent = title;
  const s = document.createElement('span'); s.textContent = sub;
  a.append(s); li.append(a); return li;
}

// ---------- pannello admin ----------
const ROLE_LABEL = { user: 'Utente', streamer: 'Streamer', admin: 'Admin' };
const fmtDate = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const td = (text, cls) => { const c = document.createElement('td'); c.textContent = text ?? '—'; if (cls) c.className = cls; return c; };

async function initAdmin() {
  const me = await loadMe();
  if (!me) { location.href = '/?p=login'; return; }
  $('admin').hidden = false;
  if (me.role !== 'admin') { $('admin').innerHTML = '<section class="card"><h1>Accesso negato</h1><p class="hint">Questa pagina è riservata agli account admin.</p></section>'; return; }

  initSeg('adminTabs', (v) => { $('adminUsers').hidden = v !== 'users'; $('adminGames').hidden = v !== 'games'; if (v === 'games' && !G.loaded) loadGames(); });

  // Account
  const U = { q: '', page: 0 };
  async function loadUsers() {
    msg($('userMsg'), '');
    let r;
    try { r = await api(`/api/admin?view=users&q=${encodeURIComponent(U.q)}&page=${U.page}`); } catch (e) { msg($('userMsg'), e.message); return; }
    const body = $('userRows'); body.innerHTML = '';
    if (!r.users.length) { const tr = document.createElement('tr'); tr.append(td('Nessun account trovato.', 'empty')); tr.firstChild.colSpan = 6; body.append(tr); }
    for (const u of r.users) {
      const tr = document.createElement('tr');
      tr.append(td(u.email + (u.confirmed ? '' : ' (da confermare)')), td(fmtDate(u.created)), td(fmtDate(u.lastSignIn)), td(u.hasKey ? 'sì' : 'no'), td(String(u.games)));
      const cell = document.createElement('td');
      const sel = document.createElement('select'); sel.className = 'roleSel';
      for (const [v, l] of Object.entries(ROLE_LABEL)) sel.append(new Option(l, v, false, v === u.role));
      sel.disabled = u.id === r.me;
      if (sel.disabled) sel.title = 'Non puoi cambiare il tuo livello';
      sel.onchange = async () => {
        sel.disabled = true;
        try { await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'set_role', userId: u.id, role: sel.value }) }); u.role = sel.value; toast(`${u.email}: ${ROLE_LABEL[sel.value]}`); }
        catch (e) { sel.value = u.role; msg($('userMsg'), e.message); }
        sel.disabled = false;
      };
      cell.append(sel); tr.append(cell); body.append(tr);
    }
    $('userCount').textContent = r.users.length ? `${r.users.length} ${r.users.length === 1 ? 'account' : 'account'} in questa pagina` : '';
    $('userPage').textContent = `pagina ${U.page + 1}`;
    $('userPrev').disabled = U.page === 0;
    $('userNext').disabled = r.users.length < r.pageSize;
  }
  let t;
  $('userSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { U.q = $('userSearch').value.trim(); U.page = 0; loadUsers(); }, 300); };
  $('userPrev').onclick = () => { U.page--; loadUsers(); };
  $('userNext').onclick = () => { U.page++; loadUsers(); };

  // Partite
  const G = { days: 0, page: 0, loaded: false, selected: new Set() };
  const updateSel = () => {
    $('deleteSelected').disabled = !G.selected.size;
    $('deleteSelected').textContent = G.selected.size ? `Elimina selezionate (${G.selected.size})` : 'Elimina selezionate';
  };
  async function loadGames() {
    G.loaded = true; G.selected.clear(); updateSel(); $('selectAll').checked = false; msg($('gameMsg'), '');
    let r;
    try { r = await api(`/api/admin?view=games&inactive=${G.days}&page=${G.page}`); } catch (e) { msg($('gameMsg'), e.message); return; }
    const body = $('gameRows'); body.innerHTML = '';
    if (!r.games.length) { const tr = document.createElement('tr'); tr.append(td('Nessuna partita.', 'empty')); tr.firstChild.colSpan = 7; body.append(tr); }
    for (const g of r.games) {
      const tr = document.createElement('tr');
      const c0 = document.createElement('td'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.id = g.id;
      cb.onchange = () => { cb.checked ? G.selected.add(g.id) : G.selected.delete(g.id); updateSel(); };
      c0.append(cb);
      const c1 = document.createElement('td'); const a = document.createElement('a'); a.href = `/?g=${g.id}`; a.target = '_blank'; a.textContent = g.id; c1.append(a);
      tr.append(c0, c1, td(`${g.white} – ${g.black}${g.model ? ` (${g.model})` : ''}`), td(g.owner || 'ospite'), td(String(g.moves)), td(g.status), td(fmtDate(g.updated)));
      body.append(tr);
    }
    $('gameCount').textContent = `${r.total} ${r.total === 1 ? 'partita' : 'partite'}`;
    $('gamePage').textContent = `pagina ${G.page + 1} di ${Math.max(1, Math.ceil(r.total / r.pageSize))}`;
    $('gamePrev').disabled = G.page === 0;
    $('gameNext').disabled = (G.page + 1) * r.pageSize >= r.total;
  }
  $('gameFilter').onchange = () => { G.days = +$('gameFilter').value; G.page = 0; loadGames(); };
  $('gamePrev').onclick = () => { G.page--; loadGames(); };
  $('gameNext').onclick = () => { G.page++; loadGames(); };
  $('selectAll').onchange = () => {
    document.querySelectorAll('#gameRows input[type=checkbox]').forEach((cb) => { cb.checked = $('selectAll').checked; cb.checked ? G.selected.add(cb.dataset.id) : G.selected.delete(cb.dataset.id); });
    updateSel();
  };
  $('deleteSelected').onclick = async () => {
    const label = $('deleteSelected').textContent;
    if (!confirmInline($('deleteSelected'), `Sicuro? Clicca di nuovo`, label)) return;
    try { const r = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'delete_games', ids: [...G.selected] }) }); toast(r.deleted === 1 ? "1 partita eliminata" : `${r.deleted} partite eliminate`); loadGames(); }
    catch (e) { msg($('gameMsg'), e.message); }
  };
  $('purgeBtn').onclick = async () => {
    const days = parseInt($('purgeDays').value, 10);
    if (!(days >= 1)) { msg($('gameMsg'), 'Indica almeno 1 giorno.'); return; }
    if (!$('purgeBtn').dataset.armed) {
      // Prima di eliminare mostra quante partite verranno toccate
      try { const r = await api(`/api/admin?view=games&inactive=${days}&page=0`); confirmInline($('purgeBtn'), `Eliminare ${r.total}? Clicca di nuovo`, 'Elimina'); }
      catch (e) { msg($('gameMsg'), e.message); }
      return;
    }
    confirmInline($('purgeBtn'), '', 'Elimina');
    try { const r = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'purge', days }) }); toast(r.deleted === 1 ? "1 partita eliminata" : `${r.deleted} partite eliminate`); loadGames(); }
    catch (e) { msg($('gameMsg'), e.message); }
  };

  loadUsers();
}

// ---------- lobby ----------
async function initLobby() {
  $('lobby').hidden = false;
  let acc = null;
  if (auth.session) acc = await loadMe();
  $('name').value = store.name() || (acc?.email ? acc.email.split('@')[0] : '');
  let picker = null;
  const updateLlmUi = async () => {
    const vsLlm = segValue('opponent') === 'llm';
    $('llmOptions').hidden = !vsLlm;
    if (!vsLlm) return;
    const canAuto = !!acc?.hasKey;
    $('modeField').hidden = !canAuto;
    const auto = canAuto && segValue('mode') === 'auto';
    $('modelField').hidden = !auto;
    if (auto && !picker) picker = await modelPicker($('lobbyModelPick'), acc.defaultModel);
    $('llmHint').innerHTML = !acc
      ? 'Senza account giochi in modalità copia e incolla. <a href="/?p=login">Accedi</a> e collega la tua chiave OpenRouter per far giocare l\'LLM da solo.'
      : !canAuto
        ? 'Nessuna chiave OpenRouter: giochi in modalità copia e incolla. <a href="/?p=account">Collega una chiave</a> per far giocare l\'LLM da solo.'
        : auto ? 'L\'LLM risponde da solo a ogni tua mossa, usando il tuo credito OpenRouter.' : 'Per ogni mossa copi il prompt nella chat del tuo LLM e inserisci la sua risposta.';
  };
  initSeg('opponent', updateLlmUi);
  initSeg('mode', updateLlmUi);
  initSeg('color');
  updateLlmUi();

  $('create').onclick = async () => {
    $('create').disabled = true; $('lobbyErr').textContent = '';
    try {
      const name = $('name').value.trim(); store.setName(name);
      const opponent = segValue('opponent');
      const auto = opponent === 'llm' && acc?.hasKey && segValue('mode') === 'auto';
      const model = auto && picker ? picker.value() : null;
      if (auto && !model) throw new Error('Scegli un modello.');
      const r = await api('/api/games', { method: 'POST', body: JSON.stringify({
        name, opponent, color: segValue('color'), mode: auto ? 'auto' : 'manual', model,
      }) });
      store.set(r.id, { token: r.token, llmToken: r.llmToken, color: r.color, opponent, created: Date.now() });
      location.href = `/?g=${r.id}`;
    } catch (e) { $('lobbyErr').textContent = e.message; $('create').disabled = false; }
  };

  // Partite recenti: dall'account se collegato, altrimenti da questo browser
  const local = Object.entries(store.all()).sort((a, b) => (b[1].created || 0) - (a[1].created || 0)).slice(0, 8);
  const items = acc?.games?.length
    ? acc.games.slice(0, 8).map((g) => gameItem(g.id, g.vsLlm ? `vs ${g.opponent}` : 'vs amico', `${g.moves} mosse · ${g.status}`))
    : local.map(([id, g]) => gameItem(id, g.opponent === 'llm' ? 'vs LLM' : 'vs amico', g.color === 'w' ? 'Bianco' : g.color === 'b' ? 'Nero' : ''));
  if (items.length) { $('myGames').hidden = false; $('gameList').replaceChildren(...items); }
}

// ---------- partita ----------
const S = { id: null, token: null, llmToken: null, view: null, flipped: false, sel: null, drag: null, llmKick: false, promptFor: null };

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
  const base = S.view && S.view.you === 'b' ? 'b' : 'w';
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
      if (pos[name]) { d.append(pieceEl(pos[name])); if (S.drag && S.drag.from === name) d.classList.add('ghost'); }
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
  if (p.kind === 'llm' && v.llm?.thinking) { const t = document.createElement('span'); t.className = 'thinking'; t.textContent = 'sta pensando'; wrap.append(t); }
  return wrap;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  const v = S.view; if (!v) return;
  renderBoard();
  const pov = orientation();
  for (const [el, c] of [[$('pTop'), pov === 'w' ? 'b' : 'w'], [$('pBottom'), pov]]) {
    el.innerHTML = ''; el.append(playerLine(c)); el.classList.toggle('turn', !v.over && v.turn === c);
  }
  // stato
  const who = (c) => { const p = c === 'w' ? v.white : v.black; return p.name || (c === 'w' ? 'il Bianco' : 'il Nero'); };
  const oppSide = v.you ? (v.you === 'w' ? v.black : v.white) : null;
  let status;
  if (v.over) {
    const win = v.result === '1-0' ? 'Vince il Bianco' : v.result === '0-1' ? 'Vince il Nero' : 'Patta';
    status = `<b>Partita finita.</b> ${win} (${v.reasonIt}).`;
  } else if (v.you && oppSide && !oppSide.joined) {
    status = 'In attesa che il tuo amico apra il link di invito…';
  } else if (v.you && v.turn === v.you) {
    status = `<b>Tocca a te.</b>${v.check ? ' Sei sotto scacco!' : ''}`;
  } else if (v.you && v.llm?.turn) {
    status = v.llm.mode === 'auto' && !v.llm.error
      ? `${escapeHtml(who(v.turn))} sta pensando…`
      : `Tocca all'LLM: inserisci la sua mossa qui sotto.`;
    if (v.check) status += ' Scacco!';
  } else if (v.you) {
    status = `Tocca a ${escapeHtml(who(v.turn))}…${v.check ? ' Scacco!' : ''}`;
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

  // invito
  const freeHuman = [v.white, v.black].some((p) => p.kind === 'human' && !p.joined);
  $('inviteCard').hidden = !(v.you && freeHuman);
  $('inviteUrl').value = `${location.origin}/?g=${v.id}`;

  // LLM
  const L = v.llm;
  const player = !!v.you && L && v.you !== L.color;
  $('llmAuto').hidden = !(L && L.mode === 'auto');
  if (L && L.mode === 'auto') {
    $('llmModel').textContent = L.model;
    $('llmState').textContent = v.over ? '' : L.thinking ? 'Sta pensando alla mossa…' : L.turn && !L.error ? 'Sta per muovere…' : L.turn ? '' : 'In attesa della tua mossa.';
    $('llmState').classList.toggle('busy', !!L.thinking);
    $('llmErrBox').hidden = !(L.error && L.turn && !v.over);
    $('llmErrText').textContent = L.error || '';
    $('llmRetry').hidden = !player;
    $('llmReplyBox').hidden = !L.lastReply;
    $('llmReply').textContent = L.lastReply || '';
  }
  // Copia e incolla: modalità manuale, oppure ripiego quando la modalità automatica ha dato errore
  const showManual = player && L.turn && !v.over && (L.mode === 'manual' || !!L.error);
  $('llmManual').hidden = !showManual;
  if (showManual) {
    const key = `${v.id}:${v.version}`;
    if (S.promptFor !== key) {
      S.promptFor = key;
      $('promptText').value = L.prompt || '';
      const sel = $('llmSelect');
      sel.replaceChildren(new Option('Elenco…', ''), ...L.legal.map((m) => new Option(m, m)));
    }
  }
  $('llmApiCard').hidden = !(S.llmToken && L && !v.over && L.mode === 'manual');
  $('llmUrl').value = `${location.origin}/api/llm?game=${v.id}&token=${S.llmToken}`;

  $('actions').hidden = !v.you;
  $('offerDraw').disabled = $('resign').disabled = v.over;
  $('offerDraw').textContent = v.drawOffer === v.you ? 'Patta proposta' : 'Proponi patta';
}

async function send(action, extra = {}) {
  $('gameErr').textContent = '';
  try {
    const r = await api('/api/game', { method: 'POST', body: JSON.stringify({ id: S.id, token: S.token, action, ...extra }) });
    setView(r.view);
    return true;
  } catch (e) { $('gameErr').textContent = e.message; return false; }
}

function setView(v) {
  if (!v) return;
  if (S.view && v.version < S.view.version) return;
  if (v.ownerTokens && v.ownerTokens.token !== S.token) {
    // Proprietario della partita su un nuovo dispositivo: recupera i token dal server
    S.token = v.ownerTokens.token; S.llmToken = v.ownerTokens.llmToken;
    store.set(v.id, { token: S.token, llmToken: S.llmToken, color: v.you, opponent: 'llm', created: Date.now() });
  }
  S.view = v;
  if (S.sel && !v.legal.some((m) => m.from === S.sel)) S.sel = null;
  render();
  maybeKickLlm();
}

// In modalità automatica, quando tocca all'LLM, chiede al server di farlo giocare.
async function maybeKickLlm(force = false) {
  const v = S.view, L = v?.llm;
  if (!L || L.mode !== 'auto' || !L.turn || v.over || !v.you || v.you === L.color) return;
  if (!force && (L.thinking || L.error)) return;
  if (S.llmKick) return;
  S.llmKick = true;
  try {
    const r = await api('/api/llm-turn', { method: 'POST', body: JSON.stringify({ id: S.id }) });
    if (r.status !== 'busy') await refresh();
  } catch (e) { $('gameErr').textContent = e.message; }
  finally { S.llmKick = false; }
}

async function refresh() {
  const nv = await api(`/api/game?id=${S.id}&token=${encodeURIComponent(S.token || '')}`);
  setView(nv);
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

function sqAt(x, y) { const el = document.elementFromPoint(x, y); return el?.closest?.('.sq')?.dataset.sq || null; }
function initBoardInput() {
  const board = $('board');
  board.addEventListener('pointerdown', (e) => {
    const sq = e.target.closest('.sq')?.dataset.sq; if (!sq || !S.view) return;
    if (S.sel && S.sel !== sq && tryPlay(S.sel, sq)) return;
    if (S.view.legal.some((m) => m.from === sq)) {
      S.sel = sq;
      const ghost = pieceEl(parsePlacement(S.view.fen)[sq]); ghost.classList.add('drag');
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
    if (d.moved && to && to !== d.from && !tryPlay(d.from, to)) S.sel = null;
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
      else maybeKickLlm(); // ad es. il "sta pensando" è scaduto senza risposta
      if (nv.over) await sleep(15000);
    } catch (e) {
      if (/non trovata/.test(e.message)) { $('status').textContent = e.message; $('actions').hidden = true; return; }
      await sleep(3000);
    }
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
      // Primo accesso da questo browser: se sei il proprietario arrivano i tuoi token, altrimenti prendi il posto libero.
      const r = await api('/api/game', { method: 'POST', body: JSON.stringify({ id, action: 'join', name: store.name() || null }) });
      if (r.token && !r.view.ownerTokens) {
        S.token = r.token;
        store.set(id, { token: r.token, color: r.view.you, opponent: 'human', created: Date.now() });
        toast(`Sei entrato con il ${r.view.you === 'w' ? 'Bianco' : 'Nero'}`);
      }
      setView(r.view);
    }
  } catch (e) { $('status').textContent = e.message; return; }
  initBoardInput();
  $('flip').onclick = () => { S.flipped = !S.flipped; render(); };
  $('resign').onclick = () => { if (confirmInline($('resign'), 'Sicuro? Clicca di nuovo', 'Abbandona')) send('resign'); };
  $('offerDraw').onclick = () => send('offer_draw');
  $('acceptDraw').onclick = () => send('accept_draw');
  $('declineDraw').onclick = () => send('decline_draw');
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy($(b.dataset.copy).value)));
  $('copyPrompt').onclick = () => copy($('promptText').value);
  $('llmSelect').onchange = () => { if ($('llmSelect').value) $('llmAnswer').value = $('llmSelect').value; };
  $('llmAnswer').onkeydown = (e) => { if (e.key === 'Enter') $('sendAnswer').click(); };
  $('sendAnswer').onclick = async () => {
    const ans = $('llmAnswer').value.trim() || $('llmSelect').value; if (!ans) return;
    $('sendAnswer').disabled = true;
    if (await send('llm_move', { move: ans })) { $('llmAnswer').value = ''; toast(`L'LLM ha giocato ${S.view.moves.at(-1)}`); }
    $('sendAnswer').disabled = false;
  };
  $('llmRetry').onclick = () => maybeKickLlm(true);
  poll();
}

// conferma "clicca due volte" (niente finestre di dialogo del browser)
function confirmInline(btn, ask, label) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; return true; }
  btn.dataset.armed = '1'; btn.textContent = ask;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
  return false;
}

// ---------- avvio ----------
const hashType = consumeAuthHash();
renderNav();
$('navLogout').onclick = async () => { await auth.signOut(); location.href = '/'; };
const qs = new URLSearchParams(location.search);
if (hashType === 'recovery') initAuth(true);
else if (qs.get('g')) initGame(qs.get('g'));
else if (qs.get('p') === 'login') initAuth();
else if (qs.get('p') === 'admin') initAdmin();
else if (qs.get('p') === 'account' || hashType === 'signup') initAccount();
else initLobby();
