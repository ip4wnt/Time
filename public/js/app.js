// ХРОНУМ — точка входа фронтенда: маршрутизация, меню, авторизация.
import { hasToken, setToken, post } from './api.js';
import { I } from './icons.js';
import { state, loadBootstrap, loadPrefs, loadDates, todayStr, ymOf, esc, addDays, addMonths } from './state.js';
import { h, toast } from './ui.js';
import { renderAuth } from './views/auth.js';
import { renderMonth } from './views/month.js';
import { renderYear } from './views/year.js';
import { renderDay } from './views/day.js';
import { renderAdd } from './views/add.js';
import { renderNotes, renderNoteEditor } from './views/notes.js';
import { renderCounters } from './views/counters.js';
import { renderDates } from './views/dates.js';
import { renderThoughts } from './views/thoughts.js';
import { renderMe } from './views/me.js';
import { renderSearch } from './views/search.js';
import { renderFin } from './views/finance.js';
import { renderActivities } from './views/activities.js';

const app = document.getElementById('app');
let currentCleanup = null;
let ready = false;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'month';
  const [pathPart, qs] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || '').entries());
  return { parts, query };
}

const ROUTES = {
  month: (p, q) => renderMonth(p[1] || state.month || ymOf(todayStr()), q),
  year: (p, q) => renderYear(p[1] || String((state.day || todayStr()).slice(0, 4)), q),
  day: (p, q) => renderDay(p[1] || state.day || todayStr(), q),
  add: (p, q) => renderAdd(q),
  notes: (p) => (p[1] ? renderNoteEditor(Number(p[1])) : renderNotes()),
  counters: () => renderCounters(),
  dates: () => renderDates(),
  thoughts: () => renderThoughts(),
  fin: (p) => renderFin(p),
  me: () => renderMe(),
  search: (p, q) => renderSearch(q),
  settings: () => renderActivities(),
  activities: () => renderActivities(), // старая ссылка — ведёт в настройки
};

async function route() {
  if (!ready) return;
  closeMenu();
  if (typeof currentCleanup === 'function') { try { await currentCleanup(); } catch { /* ignore */ } }
  currentCleanup = null;
  const { parts, query } = parseHash();
  const fn = ROUTES[parts[0]] || ROUTES.month;
  app.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    currentCleanup = await fn(parts, query, app);
  } catch (e) {
    if (e && e.status === 401) return;
    console.error(e);
    app.innerHTML = `<div class="page"><p class="err">${esc(e.message || 'Ошибка')}</p><button class="btn small ghost" onclick="location.reload()">обновить</button></div>`;
  }
}

// ---------- меню ----------
function openMenu() {
  closeMenu();
  const el = h(`<div class="menu"><div class="menu-in">
    <header class="hdr"><button class="hdr-btn" data-act="close" aria-label="закрыть">${I.close}</button><div class="hdr-title"><span>меню</span></div><button class="hdr-btn" data-act="search" aria-label="поиск">${I.search}</button></header>
    <div class="menu-block">
      <a class="mi" href="#/year">год ${I.year}</a>
      <a class="mi" href="#/month">месяц ${I.calendar}</a>
      <a class="mi" href="#/day">день ${I.clock}</a>
    </div>
    <div class="menu-block">
      <a class="mi" href="#/notes">заметки ${I.book}</a>
      <a class="mi" href="#/month?filter=food">еда ${I.apple}</a>
      <a class="mi" href="#/month?filter=task">задачи ${I.list}</a>
      <a class="mi" href="#/fin">деньги ${I.ruble}</a>
      <a class="mi" href="#/counters">счетчики ${I.timer}</a>
      <a class="mi" href="#/dates">важные даты ${I.star}</a>
      <a class="mi" href="#/thoughts">мысли ${I.cloud}</a>
    </div>
    <div class="menu-block">
      <a class="mi" href="#/settings">настройки ${I.gear}</a>
      <a class="mi" href="#/me">профиль ${I.user}</a>
      <button class="mi" data-act="logout">выйти ${I.logout}</button>
    </div>
  </div></div>`);
  el.querySelector('[data-act=close]').onclick = closeMenu;
  el.querySelector('[data-act=search]').onclick = () => { location.hash = '#/search'; };
  el.querySelector('[data-act=logout]').onclick = logout;
  el.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  document.getElementById('overlay').appendChild(el);
  state.menuOpen = true;
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  state.menuOpen = false;
  document.body.style.overflow = '';
}
window.addEventListener('chronum:menu', () => (state.menuOpen ? closeMenu() : openMenu()));

async function logout() {
  try { await post('/api/auth/logout'); } catch { /* ignore */ }
  setToken(null);
  state.user = null;
  state.events.clear();
  closeMenu();
  start();
}

// ---------- запуск ----------
async function start() {
  ready = false;
  app.innerHTML = '';
  loadPrefs();
  let ok = false;
  try { await loadBootstrap(); ok = true; } catch (e) { if (e.status !== 401 && e.status !== 0) toast(e.message); }
  if (!ok) {
    await renderAuth(app); // резолвится после успешного входа
    await loadBootstrap();
  }
  loadDates().catch(() => {});
  state.month = state.month || ymOf(todayStr());
  state.day = state.day || todayStr();
  ready = true;
  route();
}

// ---------- клавиатура (ПК): A/Ф — назад, D/В — вперёд, W/Ц и S/Ы — смена представления ----------
// Проверяем физическую клавишу (e.code), поэтому раскладка не важна.
function onKey(e) {
  if (!ready || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (state.menuOpen || document.querySelector('.dlg-back, .selbar')) return;
  if (document.body.classList.contains('bg-hours')) return; // идёт выбор часов
  const { parts } = parseHash();
  const view = parts[0] || 'month';
  if (!['day', 'month', 'year'].includes(view)) return;
  const today = todayStr();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '') ? parts[1] : (state.day || today);
  const ym = /^\d{4}-\d{2}$/.test(parts[1] || '') && view === 'month' ? parts[1] : (state.month || ymOf(today));
  const year = /^\d{4}$/.test(parts[1] || '') && view === 'year' ? Number(parts[1]) : Number((state.month || ymOf(today)).slice(0, 4));
  let go = null;
  if (e.code === 'KeyA' || e.code === 'KeyD') {
    const k = e.code === 'KeyA' ? -1 : 1;
    if (view === 'day') go = `#/day/${addDays(day, k)}`;
    else if (view === 'month') go = `#/month/${addMonths(ym, k)}`;
    else go = `#/year/${year + k}`;
  } else if (e.code === 'KeyW' || e.code === 'KeyS') {
    // W — к более крупному представлению (день → месяц → год), S — к более мелкому
    const order = ['day', 'month', 'year'];
    const to = order[order.indexOf(view) + (e.code === 'KeyW' ? 1 : -1)];
    if (!to) return;
    if (to === 'month') {
      const y = view === 'year' ? year : null;
      const m = view === 'day' ? ymOf(day) : (state.month && state.month.startsWith(String(y)) ? state.month : (ymOf(today).startsWith(String(y)) ? ymOf(today) : `${y}-01`));
      go = `#/month/${m}`;
    } else if (to === 'year') go = `#/year/${ym.slice(0, 4)}`;
    else go = `#/day/${state.day && ymOf(state.day) === ym ? state.day : (ymOf(today) === ym ? today : `${ym}-01`)}`;
  }
  if (go) { e.preventDefault(); location.hash = go; }
}
window.addEventListener('keydown', onKey);

window.addEventListener('hashchange', route);
window.addEventListener('chronum:unauth', () => { if (ready) { ready = false; start(); } });
start();
