// Guida per i nuovi arrivati: schermate con screenshot sui tre modi in cui l'AI può giocare.
// Si apre da sola alla prima visita della home; poi dal link "Guida" in alto o dai link "?" contestuali.
import { t } from '/i18n.js';

const KEY = 'chatmate:tutorial';
export const STEPS = [
  { id: 'welcome', img: 'lobby.jpg' },
  { id: 'openrouter', img: 'openrouter-key.jpg' },
  { id: 'copy', img: 'copy-paste.jpg' },
  { id: 'link', img: 'direct-link.jpg' },
  { id: 'mind', img: 'review.jpg' },
];

let cur = 0, built = false;
const $ = (id) => document.getElementById(id);

function build() {
  if (built) return; built = true;
  const el = document.createElement('div');
  el.id = 'tutorial'; el.className = 'tut'; el.hidden = true;
  el.innerHTML = `
    <div class="tutBack" data-close></div>
    <div class="tutBox" role="dialog" aria-modal="true" aria-labelledby="tutTitle">
      <button class="tutX linkBtn" data-close aria-label="×">×</button>
      <div class="tutImg"><img id="tutImg" alt=""></div>
      <div class="tutText">
        <div class="tutStep" id="tutStep"></div>
        <h2 id="tutTitle"></h2>
        <div id="tutBody" class="tutBody"></div>
      </div>
      <div class="tutNav">
        <div class="tutDots" id="tutDots"></div>
        <span class="row">
          <button id="tutPrev" class="small"></button>
          <button id="tutNext" class="small primary"></button>
        </span>
      </div>
    </div>`;
  document.body.append(el);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  $('tutPrev').onclick = () => show(cur - 1);
  $('tutNext').onclick = () => (cur >= STEPS.length - 1 ? close() : show(cur + 1));
  addEventListener('keydown', (e) => {
    if (el.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && cur < STEPS.length - 1) show(cur + 1);
    else if (e.key === 'ArrowLeft' && cur > 0) show(cur - 1);
  });
  // le immagini si caricano in anticipo, così il passaggio tra le schermate è immediato
  for (const s of STEPS) new Image().src = `/tutorial/${s.img}`;
}

function show(i) {
  cur = Math.max(0, Math.min(STEPS.length - 1, i));
  const s = STEPS[cur];
  $('tutImg').src = `/tutorial/${s.img}`;
  $('tutImg').alt = t(`tut.${s.id}.title`);
  $('tutStep').textContent = t('tut.stepOf', { n: cur + 1, m: STEPS.length });
  $('tutTitle').textContent = t(`tut.${s.id}.title`);
  $('tutBody').innerHTML = t(`tut.${s.id}.body`);
  $('tutPrev').textContent = t('tut.prev');
  $('tutPrev').hidden = cur === 0;
  $('tutNext').textContent = cur === STEPS.length - 1 ? t('tut.done') : t('tut.next');
  $('tutDots').innerHTML = STEPS.map((_, j) => `<button class="dot${j === cur ? ' on' : ''}" data-i="${j}" aria-label="${j + 1}"></button>`).join('');
  $('tutDots').onclick = (e) => { const j = e.target.dataset.i; if (j != null) show(+j); };
  $('tutorial').querySelector('.tutBox').scrollTop = 0;
}

export function openTutorial(step = 0) {
  build();
  const i = typeof step === 'string' ? STEPS.findIndex((s) => s.id === step) : step;
  $('tutorial').hidden = false;
  document.body.classList.add('noScroll');
  show(i < 0 ? 0 : i);
  $('tutNext').focus();
}

function close() {
  $('tutorial').hidden = true;
  document.body.classList.remove('noScroll');
  try { localStorage.setItem(KEY, 'done'); } catch {}
}

// Alla prima visita
export function maybeShowTutorial() {
  let seen = null;
  try { seen = localStorage.getItem(KEY); } catch {}
  if (!seen) openTutorial(0);
}
