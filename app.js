import { sqName } from '/lib/chess.js';
import { t, lang, setLang, LANGS, applyStatic, fmtDateTime } from '/i18n.js';

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
  async signOut() { const tk = this.session?.access_token; this.clear(); if (tk) this.call('logout', {}, tk).catch(() => {}); },
};

function authError(d) {
  const m = String(d.msg || d.error_description || d.message || d.error || '').toLowerCase();
  if (m.includes('invalid login')) return t('auth.err.invalid');
  if (m.includes('not confirmed')) return t('auth.err.notConfirmed');
  if (m.includes('already registered')) return t('auth.err.exists');
  if (m.includes('password should be')) return t('auth.err.short');
  if (m.includes('rate limit') || m.includes('seconds')) return t('auth.err.rate');
  return d.msg || d.error_description || d.message || t('auth.err.generic');
}

// Ritorno dal link nell'email (conferma registrazione o recupero password): i token sono nell'hash dell'URL.
function consumeAuthHash() {
  if (!location.hash.includes('access_token') && !location.hash.includes('error')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error')) { toast(p.get('error_description') || t('auth.err.link')); return null; }
  auth.save({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') });
  return p.get('type');
}

async function api(path, opts = {}) {
  const token = await auth.token();
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Lang': lang, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || t('common.errorStatus', { status: r.status })); e.code = data.code; e.status = r.status; throw e; }
  return data;
}

function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('common.copied')); }
  catch { toast(t('common.copyFail')); }
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
const usd = (x) => (x === 0 ? t('common.free') : x < 0.01 ? `$${x.toPrecision(2)}` : `$${x.toFixed(2)}`);
const range = ([a, b]) => (Math.abs(a - b) < 1e-9 ? `~${usd(a)}` : `${usd(a)}–${usd(b)}`);

async function modelPicker(container, initial) {
  container.innerHTML = '';
  const sel = document.createElement('select');
  const custom = document.createElement('input');
  custom.placeholder = t('model.idPh');
  custom.hidden = true;
  const info = document.createElement('p'); info.className = 'hint costInfo';
  container.append(sel, custom, info);
  const { groups, estimate } = await loadModels();
  const byId = {};
  let found = false;
  for (const g of groups) {
    const og = document.createElement('optgroup'); og.label = g.free ? t('model.freeGroup') : g.label;
    for (const m of g.models) {
      byId[m.id] = m;
      const o = document.createElement('option'); o.value = m.id;
      o.textContent = m.name + (m.cost ? ` · ${m.cost.perGame[1] === 0 ? t('common.free') : t('model.perGame', { range: range(m.cost.perGame) })}` : '');
      if (m.id === initial) { o.selected = true; found = true; }
      og.append(o);
    }
    sel.append(og);
  }
  const other = document.createElement('option'); other.value = '__custom'; other.textContent = t('model.other');
  sel.append(other);
  if (initial && !found) { other.selected = true; custom.hidden = false; custom.value = initial; }
  if (!groups.length) { other.selected = true; custom.hidden = false; }
  const showInfo = () => {
    const m = byId[sel.value];
    if (!m || !m.cost) { info.textContent = sel.value === '__custom' ? t('model.customNoCost') : ''; return; }
    const c = m.cost, [a, b] = estimate.movesPerGame;
    info.textContent = c.perGame[1] === 0
      ? t('model.freeInfo')
      : t('model.estimate', { move: range(c.perMove), game: range(c.perGame), a, b }) + (c.reasoning ? t('model.reasoning') : '');
  };
  sel.onchange = () => { custom.hidden = sel.value !== '__custom'; if (!custom.hidden) custom.focus(); showInfo(); };
  showInfo();
  return { value: () => (sel.value === '__custom' ? custom.value.trim() : sel.value) };
}

// Editor dei modelli in gara (max 5): selettore + "Aggiungi" + elenco con costo stimato
async function poolEditor(container, initial = []) {
  container.innerHTML = '';
  const list = document.createElement('div'); list.className = 'poolList';
  const pickBox = document.createElement('div'); pickBox.className = 'modelPick';
  const add = document.createElement('button'); add.className = 'small'; add.type = 'button'; add.textContent = t('pool.add');
  container.append(list, pickBox, add);
  const picker = await modelPicker(pickBox, null);
  const { groups } = await loadModels();
  const info = Object.fromEntries(groups.flatMap((g) => g.models).map((m) => [m.id, m]));
  let pool = [...initial];
  const draw = () => {
    list.innerHTML = '';
    if (!pool.length) list.innerHTML = `<span class="hint">${t('pool.empty')}</span>`;
    pool.forEach((id, i) => {
      const chip = document.createElement('span'); chip.className = 'poolChip';
      const m = info[id];
      chip.textContent = `${i + 1}. ${m ? m.name : id}${m?.cost ? ` · ${m.cost.perGame[1] === 0 ? t('common.free') : range(m.cost.perGame)}` : ''}`;
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = t('pool.remove');
      x.onclick = () => { pool.splice(i, 1); draw(); };
      chip.append(x); list.append(chip);
    });
    add.disabled = pool.length >= 5;
  };
  add.onclick = () => { const id = picker.value(); if (id && !pool.includes(id) && pool.length < 5) { pool.push(id); draw(); } };
  draw();
  return { value: () => [...pool] };
}

// Collega la scelta del modello (fisso / casuale / votato) all'editor dei modelli in gara
function initCycle(prefix, mode = 'fixed', pool = []) {
  const seg = $(`${prefix}ModelMode`);
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
  let editor = null;
  const update = async (m) => {
    $(`${prefix}PoolField`).hidden = m === 'fixed';
    if (m !== 'fixed' && !editor) editor = await poolEditor($(`${prefix}Pool`), pool);
  };
  initSeg(`${prefix}ModelMode`, update);
  update(mode);
  return { mode: () => segValue(`${prefix}ModelMode`), pool: () => (editor ? editor.value() : pool) };
}

// ---------- pagina accesso ----------
function initAuth(recovery = false) {
  $('auth').hidden = false;
  let tab = 'login';
  const setTab = (tb) => {
    tab = tb;
    $('authSubmit').textContent = tb === 'login' ? t('auth.login') : tb === 'signup' ? t('auth.createAccount') : t('auth.sendReset');
    $('authPassField').hidden = tb === 'forgot';
    $('authPass').required = tb !== 'forgot';
    $('authPass').autocomplete = tb === 'signup' ? 'new-password' : 'current-password';
    $('authForgot').hidden = tb !== 'login';
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
        msg($('authMsg'), t('auth.checkEmail'), true);
      } else {
        await auth.recover(email);
        msg($('authMsg'), t('auth.resetSent'), true);
      }
    } catch (err) { msg($('authMsg'), err.message); }
    $('authSubmit').disabled = false;
  };
  if (recovery) {
    $('authForm').hidden = true; $('authTabs').hidden = true; $('resetForm').hidden = false;
    $('resetForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await auth.setPassword($('newPass').value); toast(t('auth.passwordUpdated')); location.href = '/'; }
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
    $('accEmail').textContent = t('acc.loggedAs', { email: acc.email });
    $('keyStatus').innerHTML = acc.hasKey
      ? `<span class="badge ok">${t('acc.badgeLinked')}</span> ${t('acc.keyEnding')} <code>…${escapeHtml(acc.keyLast4)}</code>`
      : `<span class="badge">${t('acc.badgeNone')}</span> ${t('acc.noKeyText')}`;
    $('keyRemove').hidden = !acc.hasKey;
    $('reasoningOn').checked = acc.reasoning !== false;
    $('keyInput').placeholder = acc.hasKey ? t('acc.replacePh') : 'sk-or-...';
    const ul = $('accGames'); ul.innerHTML = '';
    if (!acc.games.length) ul.innerHTML = `<li class="hint">${t('acc.noGames')}</li>`;
    for (const g of acc.games) ul.append(gameItem(g.id, gameTitle(g), gameSub(g)));
  };
  acc = await loadMe();
  if (!acc) { msg($('accMsg'), t('acc.loadFail')); return; }
  render();
  const picker = await modelPicker($('accModelPick'), acc.defaultModel);
  $('keySave').onclick = async () => {
    const key = $('keyInput').value.trim(); if (!key) return;
    $('keySave').disabled = true; msg($('accMsg'), t('acc.checking'), true);
    try { acc = { ...acc, ...(await api('/api/account', { method: 'POST', body: JSON.stringify({ action: 'set_key', key }) })) }; $('keyInput').value = ''; render(); msg($('accMsg'), t('acc.keySaved'), true); }
    catch (e) { msg($('accMsg'), e.message); }
    $('keySave').disabled = false;
  };
  $('keyRemove').onclick = async () => {
    if (!confirmInline($('keyRemove'), t('common.sure'), t('acc.removeKey'))) return;
    try { acc = { ...acc, ...(await api('/api/account', { method: 'POST', body: JSON.stringify({ action: 'remove_key' }) })) }; render(); msg($('accMsg'), t('acc.keyRemoved'), true); }
    catch (e) { msg($('accMsg'), e.message); }
  };
  $('reasoningOn').onchange = async () => {
    const enabled = $('reasoningOn').checked;
    try { acc = { ...acc, ...(await api('/api/account', { method: 'POST', body: JSON.stringify({ action: 'set_reasoning', enabled }) })) }; msg($('accMsg'), t(enabled ? 'acc.reasoningOn' : 'acc.reasoningOff'), true); }
    catch (e) { $('reasoningOn').checked = !enabled; msg($('accMsg'), e.message); }
  };
  $('modelSave').onclick = async () => {
    try { acc = { ...acc, ...(await api('/api/account', { method: 'POST', body: JSON.stringify({ action: 'set_model', model: picker.value() }) })) }; msg($('accMsg'), t('acc.modelSaved'), true); }
    catch (e) { msg($('accMsg'), e.message); }
  };
}

// Titolo e sottotitolo di una partita nelle liste
const statusText = (s) => (s === '1-0' ? t('game.whiteWins') : s === '0-1' ? t('game.blackWins') : s === '1/2-1/2' ? t('game.draw') : s === 'ongoing' ? t('status.ongoing') : '');
const gameTitle = (g) => (g.duel ? g.opponent : g.vsLlm ? t('list.vs', { name: g.opponent || 'LLM' }) : t('list.vsFriend'));
// spesa reale: sotto il centesimo due cifre significative ($0.0034), sotto il dollaro tre decimali ($0.025), poi due
const spend = (x) => (x < 0.01 ? `$${x.toPrecision(2)}` : x < 1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);
const gameSub = (g) => [t('list.moves', { n: g.moves }), statusText(g.status), g.cost > 0 ? t('list.spent', { cost: spend(g.cost) }) : ''].filter(Boolean).join(' · ');

function gameItem(id, title, sub) {
  const li = document.createElement('li');
  const a = document.createElement('a'); a.href = `/?g=${id}`; a.textContent = title;
  const s = document.createElement('span'); s.textContent = sub;
  a.append(s); li.append(a); return li;
}

// ---------- pannello admin ----------
const roleLabel = (r) => t(`role.${r}`);
const fmtDate = fmtDateTime;
const td = (text, cls) => { const c = document.createElement('td'); c.textContent = text ?? '—'; if (cls) c.className = cls; return c; };

async function initAdmin() {
  const me = await loadMe();
  if (!me) { location.href = '/?p=login'; return; }
  $('admin').hidden = false;
  if (me.role !== 'admin') { $('admin').innerHTML = `<section class="card"><h1>${t('admin.deniedTitle')}</h1><p class="hint">${t('admin.deniedText')}</p></section>`; return; }

  initSeg('adminTabs', (v) => { $('adminUsers').hidden = v !== 'users'; $('adminGames').hidden = v !== 'games'; if (v === 'games' && !G.loaded) loadGames(); });

  // Account
  const U = { q: '', page: 0 };
  async function loadUsers() {
    msg($('userMsg'), '');
    let r;
    try { r = await api(`/api/admin?view=users&q=${encodeURIComponent(U.q)}&page=${U.page}`); } catch (e) { msg($('userMsg'), e.message); return; }
    const body = $('userRows'); body.innerHTML = '';
    if (!r.users.length) { const tr = document.createElement('tr'); tr.append(td(t('admin.noAccounts'), 'empty')); tr.firstChild.colSpan = 6; body.append(tr); }
    for (const u of r.users) {
      const tr = document.createElement('tr');
      tr.append(td(u.email + (u.confirmed ? '' : t('admin.toConfirm'))), td(fmtDate(u.created)), td(fmtDate(u.lastSignIn)), td(u.hasKey ? t('common.yes') : t('common.no')), td(String(u.games)));
      const cell = document.createElement('td');
      const sel = document.createElement('select'); sel.className = 'roleSel';
      for (const v of ['user', 'streamer', 'admin']) sel.append(new Option(roleLabel(v), v, false, v === u.role));
      sel.disabled = u.id === r.me;
      if (sel.disabled) sel.title = t('admin.ownRole');
      sel.onchange = async () => {
        sel.disabled = true;
        try { await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'set_role', userId: u.id, role: sel.value }) }); u.role = sel.value; toast(`${u.email}: ${roleLabel(sel.value)}`); }
        catch (e) { sel.value = u.role; msg($('userMsg'), e.message); }
        sel.disabled = false;
      };
      cell.append(sel); tr.append(cell); body.append(tr);
    }
    $('userCount').textContent = r.users.length ? t('admin.perPage', { n: r.users.length }) : '';
    $('userPage').textContent = t('admin.page', { n: U.page + 1 });
    $('userPrev').disabled = U.page === 0;
    $('userNext').disabled = r.users.length < r.pageSize;
  }
  let searchTimer;
  $('userSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { U.q = $('userSearch').value.trim(); U.page = 0; loadUsers(); }, 300); };
  $('userPrev').onclick = () => { U.page--; loadUsers(); };
  $('userNext').onclick = () => { U.page++; loadUsers(); };

  // Partite
  const G = { days: 0, page: 0, loaded: false, selected: new Set() };
  const updateSel = () => {
    $('deleteSelected').disabled = !G.selected.size;
    $('deleteSelected').textContent = G.selected.size ? t('admin.deleteN', { n: G.selected.size }) : t('admin.deleteSelected');
  };
  async function loadGames() {
    G.loaded = true; G.selected.clear(); updateSel(); $('selectAll').checked = false; msg($('gameMsg'), '');
    let r;
    try { r = await api(`/api/admin?view=games&inactive=${G.days}&page=${G.page}`); } catch (e) { msg($('gameMsg'), e.message); return; }
    const body = $('gameRows'); body.innerHTML = '';
    if (!r.games.length) { const tr = document.createElement('tr'); tr.append(td(t('admin.noGames'), 'empty')); tr.firstChild.colSpan = 7; body.append(tr); }
    for (const g of r.games) {
      const tr = document.createElement('tr');
      const c0 = document.createElement('td'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.id = g.id;
      cb.onchange = () => { cb.checked ? G.selected.add(g.id) : G.selected.delete(g.id); updateSel(); };
      c0.append(cb);
      const c1 = document.createElement('td'); const a = document.createElement('a'); a.href = `/?g=${g.id}`; a.target = '_blank'; a.textContent = g.id; c1.append(a);
      tr.append(c0, c1, td(`${g.white || t('admin.anon')} – ${g.black || t('admin.anon')}${g.model ? ` (${g.model})` : ''}`), td(g.owner || t('admin.guest')), td(String(g.moves)), td(statusText(g.status)), td(fmtDate(g.updated)));
      body.append(tr);
    }
    $('gameCount').textContent = (r.total === 1 ? t('admin.gamesCount1') : t('admin.gamesCount', { n: r.total }));
    $('gamePage').textContent = t('admin.pageOf', { n: G.page + 1, m: Math.max(1, Math.ceil(r.total / r.pageSize)) });
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
    if (!confirmInline($('deleteSelected'), t('common.sure'), label)) return;
    try { const r = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'delete_games', ids: [...G.selected] }) }); toast(r.deleted === 1 ? t('admin.deleted1') : t('admin.deleted', { n: r.deleted })); loadGames(); }
    catch (e) { msg($('gameMsg'), e.message); }
  };
  $('purgeBtn').onclick = async () => {
    const days = parseInt($('purgeDays').value, 10);
    if (!(days >= 1)) { msg($('gameMsg'), t('admin.minDay')); return; }
    if (!$('purgeBtn').dataset.armed) {
      // Prima di eliminare mostra quante partite verranno toccate
      try { const r = await api(`/api/admin?view=games&inactive=${days}&page=0`); confirmInline($('purgeBtn'), t('admin.confirmN', { n: r.total }), t('common.delete')); }
      catch (e) { msg($('gameMsg'), e.message); }
      return;
    }
    confirmInline($('purgeBtn'), '', t('common.delete'));
    try { const r = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'purge', days }) }); toast(r.deleted === 1 ? t('admin.deleted1') : t('admin.deleted', { n: r.deleted })); loadGames(); }
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
  const canTwitch = acc && (acc.role === 'streamer' || acc.role === 'admin');
  $('optTwitch').hidden = !canTwitch;
  const canDuel = acc?.role === 'admin';
  $('optDuel').hidden = !canDuel;
  let duelW = null, duelB = null;
  const cycle = canTwitch ? initCycle('tw') : null;
  const updateLlmUi = async () => {
    const opp = segValue('opponent');
    const vsLlm = opp === 'llm', twitch = opp === 'twitch', duel = opp === 'duel';
    $('twitchOptions').hidden = !twitch;
    $('duelOptions').hidden = !duel;
    $('nameField').hidden = $('colorField').hidden = duel;
    if (duel) {
      $('llmOptions').hidden = true;
      if (acc?.hasKey && !duelW) { duelW = await modelPicker($('duelWhite'), acc.defaultModel); duelB = await modelPicker($('duelBlack'), acc.defaultModel); }
      $('duelWhite').parentElement.hidden = $('duelBlack').parentElement.hidden = !acc?.hasKey;
      $('duelHint').innerHTML = acc?.hasKey ? t('duel.hint') : t('duel.hintNoKey');
      return;
    }
    $('colorLabel').textContent = twitch ? t('lobby.chatColor') : t('lobby.yourColor');
    $('modelLabel').textContent = twitch ? t('lobby.firstModel') : t('lobby.model');
    if (twitch) {
      $('llmOptions').hidden = false;
      $('modeField').hidden = true;
      $('modelField').hidden = !acc?.hasKey;
      if (acc?.hasKey && !picker) picker = await modelPicker($('lobbyModelPick'), acc.defaultModel);
      $('llmHint').innerHTML = acc?.hasKey
        ? t('lobby.hintTwitch')
        : t('lobby.hintTwitchNoKey');
      return;
    }
    $('llmOptions').hidden = !vsLlm;
    if (!vsLlm) return;
    const canAuto = !!acc?.hasKey;
    $('modeField').hidden = !canAuto;
    const auto = canAuto && segValue('mode') === 'auto';
    $('modelField').hidden = !auto;
    if (auto && !picker) picker = await modelPicker($('lobbyModelPick'), acc.defaultModel);
    $('llmHint').innerHTML = !acc
      ? t('lobby.hintNoAccount')
      : !canAuto
        ? t('lobby.hintNoKey')
        : auto ? t('lobby.hintAuto') : t('lobby.hintManual');
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
      if (opponent === 'duel') {
        const r = await api('/api/games', { method: 'POST', body: JSON.stringify({ opponent, modelWhite: duelW?.value(), modelBlack: duelB?.value() }) });
        store.set(r.id, { opponent: 'duel', created: Date.now() });
        location.href = `/?g=${r.id}`;
        return;
      }
      if (opponent === 'twitch') {
        const r = await api('/api/games', { method: 'POST', body: JSON.stringify({
          opponent, color: segValue('color'), model: picker ? picker.value() : null,
          channel: $('twChannel').value, voteSeconds: $('twVote').value, graceSeconds: $('twGrace').value,
          autoNext: $('twNext').value, modelMode: cycle.mode(), modelPool: cycle.pool(),
        }) });
        store.set(r.id, { token: r.token, llmToken: r.llmToken, color: r.color, opponent: 'twitch', created: Date.now() });
        location.href = `/?g=${r.id}`;
        return;
      }
      const auto = opponent === 'llm' && acc?.hasKey && segValue('mode') === 'auto';
      const model = auto && picker ? picker.value() : null;
      if (auto && !model) throw new Error(t('lobby.pickModel'));
      const r = await api('/api/games', { method: 'POST', body: JSON.stringify({
        name, opponent, color: segValue('color'), mode: auto ? 'auto' : 'manual', model,
      }) });
      store.set(r.id, { token: r.token, llmToken: r.llmToken, color: r.color, opponent, created: Date.now() });
      location.href = `/?g=${r.id}`;
    } catch (e) { $('lobbyErr').textContent = e.message; $('create').disabled = false; }
  };

  // Partite recenti: solo per gli utenti registrati, prese dal loro account
  const items = (acc?.games || []).slice(0, 8).map((g) => gameItem(g.id, gameTitle(g), gameSub(g)));
  if (items.length) { $('myGames').hidden = false; $('gameList').replaceChildren(...items); }
}

// ---------- partita ----------
const S = { id: null, token: null, llmToken: null, liveKey: null, view: null, flipped: false, sel: null, drag: null, llmKick: false, promptFor: null };

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
  name.textContent = p.name || (p.joined ? (color === 'w' ? t('common.white') : t('common.black')) : t('game.waitingPlayer'));
  wrap.append(dot, name);
  if (p.kind === 'llm') { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = 'LLM'; wrap.append(tg); }
  if (v.you === color) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('tag.you'); wrap.append(tg); }
  if (p.kind === 'llm' && v.llm?.thinking) { const tg = document.createElement('span'); tg.className = 'thinking'; tg.textContent = t('tag.thinking'); wrap.append(tg); }
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
  const who = (c) => { const p = c === 'w' ? v.white : v.black; return p.name || (c === 'w' ? t('common.white') : t('common.black')); };
  const oppSide = v.you ? (v.you === 'w' ? v.black : v.white) : null;
  let status;
  if (v.over) {
    status = t('game.over', { result: statusText(v.result), reason: t(`reason.${v.reason}`) });
  } else if (v.you && oppSide && !oppSide.joined) {
    status = t('game.waitFriend');
  } else if (v.llm?.duel) {
    status = (v.llm.error ? t('game.turnOf', { name: escapeHtml(who(v.turn)) }) : t('game.thinking', { name: escapeHtml(who(v.turn)) })) + (v.check ? t('game.check') : '');
  } else if (v.mode === 'twitch' && v.you && v.turn === v.you) {
    status = t('game.chatTurn') + (v.check ? t('game.check') : '');
  } else if (v.you && v.turn === v.you) {
    status = t('game.yourTurn') + (v.check ? t('game.inCheck') : '');
  } else if (v.you && v.llm?.turn) {
    status = v.llm.mode === 'auto' && !v.llm.error
      ? t('game.thinking', { name: escapeHtml(who(v.turn)) })
      : t('game.llmManualTurn');
    if (v.check) status += t('game.check');
  } else if (v.you) {
    status = t('game.turnOf', { name: escapeHtml(who(v.turn)) }) + (v.check ? t('game.check') : '');
  } else {
    status = t('game.spectating', { name: escapeHtml(who(v.turn)) });
  }
  $('status').innerHTML = status;
  document.title = (!v.over && v.you && v.turn === v.you && v.mode !== 'twitch' ? t('game.titleYourTurn') : '') + 'ChatMate';
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
  $('copyPgn').hidden = !v.moves.length;

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
    $('llmState').textContent = v.over ? '' : L.thinking ? t('llm.thinking') : L.turn && !L.error ? t('llm.aboutToMove') : L.turn ? '' : v.mode === 'twitch' ? t('llm.waitingChat') : t('llm.waitingYou');
    $('llmState').classList.toggle('busy', !!L.thinking);
    // spesa della partita (solo il proprietario la riceve)
    const c = L.cost, total = c ? c.w + c.b : 0;
    $('llmCost').hidden = !c;
    if (c) {
      $('llmCost').innerHTML = L.duel && total > 0
        ? `${t('game.spent')}: ${escapeHtml(v.white.name)} <b>${spend(c.w)}</b> · ${escapeHtml(v.black.name)} <b>${spend(c.b)}</b> · ${t('game.total')} <b>${spend(total)}</b>`
        : `${t('game.spent')}: <b>${total > 0 ? spend(total) : '$0'}</b>`;
    }
    $('llmErrBox').hidden = !(L.error && L.turn && !v.over);
    $('llmErrText').textContent = L.error ? llmErrorText(L.error) + (player ? t('llmerr.suffix') : '') : '';
    $('llmRetry').hidden = !(player || L.canRetry);
    // ragionamento dell'ultima mossa, separato dalla risposta (solo modelli che lo forniscono)
    // nei duelli il ragionamento è di chi ha appena mosso: si indica anche il modello
    const lastLlmMove = L.duel && v.moves.length
      ? `${(v.moves.length % 2 ? v.white : v.black).name} · ${v.moves.at(-1)}`
      : lastMoveOf(v, L.color);
    $('llmReasonBox').hidden = !L.reasoning;
    if (!L.reasoning) $('reasonAsk').hidden = true;
    $('llmReasonMove').textContent = L.reasoning && lastLlmMove ? `· ${lastLlmMove}` : '';
    if ($('llmReason').dataset.src !== L.reasoning) { $('llmReason').dataset.src = L.reasoning || ''; $('llmReason').textContent = L.reasoning || ''; }
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
      sel.replaceChildren(new Option(t('manual.list'), ''), ...L.legal.map((m) => new Option(m, m)));
    }
  }
  $('llmApiCard').hidden = !(S.llmToken && L && !v.over && L.mode === 'manual');
  $('llmUrl').value = `${location.origin}/api/llm?game=${v.id}&token=${S.llmToken}`;

  $('actions').hidden = !v.you;
  $('offerDraw').hidden = v.mode === 'twitch';
  $('offerDraw').disabled = $('resign').disabled = v.over;
  $('liveCard').hidden = !(v.mode === 'twitch' && v.ownerTokens?.liveKey);
  if (!$('liveCard').hidden && !S.liveKey) startLivePanel(v);
  $('offerDraw').textContent = v.drawOffer === v.you ? t('game.drawProposed') : t('game.offerDraw');
}

// Ultima mossa giocata da un colore (il Bianco muove agli indici pari)
function lastMoveOf(v, color) {
  for (let i = v.moves.length - 1; i >= 0; i--) if ((i % 2 === 0) === (color === 'w')) return v.moves[i];
  return null;
}

// PGN della partita (intestazioni standard + mosse numerate)
function toPGN(v) {
  const name = (p, c) => p.name || (c === 'w' ? 'White' : 'Black');
  const esc = (s) => String(s).replace(/["\\]/g, '');
  const d = new Date();
  const result = v.over ? v.result : '*';
  const tags = [
    ['Event', 'ChatMate game'], ['Site', `${location.origin}/?g=${v.id}`],
    ['Date', `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`],
    ['White', name(v.white, 'w')], ['Black', name(v.black, 'b')], ['Result', result],
  ];
  if (v.over && v.reason) tags.push(['Termination', v.reason.replace(/_/g, ' ')]);
  const parts = [];
  v.moves.forEach((m, i) => { if (i % 2 === 0) parts.push(`${i / 2 + 1}.`); parts.push(m); });
  parts.push(result);
  // righe di al massimo 80 caratteri, come vuole lo standard
  const lines = []; let line = '';
  for (const p of parts) { if (line && line.length + 1 + p.length > 80) { lines.push(line); line = p; } else line = line ? `${line} ${p}` : p; }
  if (line) lines.push(line);
  return `${tags.map(([k, val]) => `[${k} "${esc(val)}"]`).join('\n')}\n\n${lines.join('\n')}\n`;
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
  if (!L || L.mode !== 'auto' || !L.turn || v.over) return;
  if (!L.duel && (!v.you || v.you === L.color)) return;
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
      if (e.code === 'not_found' || e.status === 404) { $('status').textContent = e.message; $('actions').hidden = true; return; }
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
        toast(t('game.joined', { color: r.view.you === 'w' ? t('col.white') : t('col.black') }));
      }
      setView(r.view);
    }
  } catch (e) { $('status').textContent = e.message; return; }
  initBoardInput();
  $('flip').onclick = () => { S.flipped = !S.flipped; render(); };
  $('resign').onclick = () => { if (confirmInline($('resign'), t('common.sure'), t('game.resign'))) send('resign'); };
  $('offerDraw').onclick = () => send('offer_draw');
  $('acceptDraw').onclick = () => send('accept_draw');
  $('declineDraw').onclick = () => send('decline_draw');
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy($(b.dataset.copy).value)));
  $('copyPrompt').onclick = () => copy($('promptText').value);
  $('copyPgn').onclick = () => S.view && copy(toPGN(S.view));
  $('llmSelect').onchange = () => { if ($('llmSelect').value) $('llmAnswer').value = $('llmSelect').value; };
  $('llmAnswer').onkeydown = (e) => { if (e.key === 'Enter') $('sendAnswer').click(); };
  $('sendAnswer').onclick = async () => {
    const ans = $('llmAnswer').value.trim() || $('llmSelect').value; if (!ans) return;
    $('sendAnswer').disabled = true;
    if (await send('llm_move', { move: ans })) { $('llmAnswer').value = ''; toast(t('game.llmPlayed', { move: S.view.moves.at(-1) })); }
    $('sendAnswer').disabled = false;
  };
  $('llmRetry').onclick = () => maybeKickLlm(true);
  // Prima di sbirciare il ragionamento dell'LLM si chiede conferma (una volta per partita)
  $('llmReasonBox').querySelector('summary').onclick = (e) => {
    if ($('llmReasonBox').open || store.get(S.id)?.peek || S.view?.llm?.duel) return;
    e.preventDefault();
    $('reasonAsk').hidden = false;
  };
  $('reasonYes').onclick = () => { store.set(S.id, { peek: true }); $('reasonAsk').hidden = true; $('llmReasonBox').open = true; };
  $('reasonNo').onclick = () => { $('reasonAsk').hidden = true; };
  poll();
}

// ---------- pannello live Twitch (solo lo streamer proprietario) ----------
const livePhase = (p) => t(`live.phase.${p}`);

// Testo leggibile di un errore dell'LLM salvato come codice ('llm_invalid_moves|3', 'or_other|dettaglio')
function llmErrorText(code) {
  const [k, rest = ''] = String(code).split('|');
  const key = `llmerr.${k}`;
  const s = t(key, { n: rest, detail: rest });
  return s === key ? String(code) : s;
}

function startLivePanel(v) {
  S.liveKey = v.ownerTokens.liveKey;
  const ol = $('overlayLang');
  ol.replaceChildren(...Object.entries(LANGS).map(([c, n]) => new Option(n, c, false, c === lang)));
  const url = () => `${location.origin}/overlay.html?key=${S.liveKey}&lang=${ol.value}${$('overlayTransparent').checked ? '&bg=transparent' : ''}`;
  $('overlayUrl').value = url();
  $('overlayTransparent').onchange = ol.onchange = () => { $('overlayUrl').value = url(); };
  $('liveChannel').textContent = `#${v.twitch.channel}`;
  $('setChannel').value = v.twitch.channel; $('setVote').value = v.twitch.voteSeconds; $('setGrace').value = v.twitch.graceSeconds;
  $('setNext').value = v.twitch.autoNext || 0;
  const cycle = initCycle('set', v.twitch.modelMode || 'fixed', v.twitch.modelPool || []);
  const live = (body) => api('/api/live', { method: 'POST', body: JSON.stringify({ key: S.liveKey, ...body }) });
  $('saveLive').onclick = async () => {
    try {
      const r = await live({ action: 'settings', channel: $('setChannel').value, voteSeconds: $('setVote').value, graceSeconds: $('setGrace').value,
        autoNext: $('setNext').value, modelMode: cycle.mode(), modelPool: cycle.pool() });
      $('liveChannel').textContent = `#${r.channel}`; toast(t('live.saved'));
    } catch (e) { $('gameErr').textContent = e.message; }
  };
  $('sendTest').onclick = async () => {
    try {
      const r = await live({ action: 'votes', votes: [{ voter: `test:${$('testVoter').value.trim() || 'test'}`, move: $('testMove').value.trim() }] });
      toast(r.accepted ? t('live.voteOk') : r.reason ? t(`live.${r.reason}`) : t('live.voteBad'));
    } catch (e) { $('gameErr').textContent = e.message; }
  };
  $('newLiveGame').onclick = async () => {
    if (!confirmInline($('newLiveGame'), t('common.sure'), t('live.newGame'))) return;
    try {
      const cur = S.view;
      const r = await api('/api/games', { method: 'POST', body: JSON.stringify({
        opponent: 'twitch', color: cur.you, model: cur.llm?.model, channel: $('setChannel').value,
        voteSeconds: $('setVote').value, graceSeconds: $('setGrace').value,
        autoNext: $('setNext').value, modelMode: cycle.mode(), modelPool: cycle.pool(),
      }) });
      store.set(r.id, { token: r.token, llmToken: r.llmToken, color: r.color, opponent: 'twitch', created: Date.now() });
      location.href = `/?g=${r.id}`;
    } catch (e) { $('gameErr').textContent = e.message; }
  };
  liveLoop(live);
}

// Segue la live e, se l'overlay non è aperto, fa avanzare i turni al posto suo.
async function liveLoop(live) {
  let ticking = false;
  for (;;) {
    try {
      const r = await fetch(`/api/live?key=${encodeURIComponent(S.liveKey)}`);
      const lv = await r.json();
      if (r.ok && lv.gameId === S.id) {
        const offset = lv.serverNow - Date.now();
        const left = lv.endsAt ? Math.max(0, Math.ceil((lv.endsAt - Date.now() - offset) / 1000)) : null;
        const top = lv.moves.filter((m) => m.votes).slice(0, 8);
        $('liveState').innerHTML =
          `<b>${livePhase(lv.phase)}</b>${lv.tieBreak ? t('live.tie') : ''}${left != null && lv.phase === 'voting' ? ` · ${left}s` : ''} · ${t('live.round', { n: lv.round })} · ${t('live.votes', { n: lv.totalVotes })}` +
          (top.length ? `<div class="tally">${top.map((m) => `<span>${m.san} ${m.votes}</span>`).join('')}</div>` : '');
        const due = lv.phase === 'idle' || lv.phase === 'closing';
        if (due && !ticking) { ticking = true; try { await live({ action: 'tick' }); } catch {} ticking = false; }
        if (lv.phase === 'next' && lv.next) {
          const at = lv.next.at ? Math.max(0, Math.ceil((lv.next.at - Date.now() - offset) / 1000)) : null;
          $('liveState').innerHTML = t('live.next') + (at != null ? t('live.inSec', { n: at }) : '') +
            (lv.next.mode === 'vote' ? `<div class="tally">${lv.next.options.map((o) => `<span>${o.n}. ${o.name} ${o.votes}</span>`).join('')}</div>` : '');
          if ((!lv.next.at || Date.now() + offset >= lv.next.graceEndsAt) && !ticking) { ticking = true; try { await live({ action: 'tick' }); } catch {} ticking = false; }
        }
      } else if (r.ok) {
        // l'overlay è passato a una partita più recente (ad es. quella partita in automatico)
        $('liveState').innerHTML = t('live.newer', { id: encodeURIComponent(lv.gameId) });
      }
    } catch {}
    await sleep(1000);
  }
}

// conferma "clicca due volte" (niente finestre di dialogo del browser)
function confirmInline(btn, ask, label) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; return true; }
  btn.dataset.armed = '1'; btn.textContent = ask;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
  return false;
}

// ---------- avvio ----------
applyStatic();
{
  const ls = $('langSel');
  ls.replaceChildren(...Object.entries(LANGS).map(([c, n]) => new Option(n, c, false, c === lang)));
  ls.onchange = () => { setLang(ls.value); location.reload(); };
}
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
