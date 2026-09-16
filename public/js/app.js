// ХРОНУМ — точка входа фронтенда: маршрутизация, меню, авторизация.
import { hasToken, setToken, post } from './api.js';
import { I } from './icons.js';
import { state, loadBootstrap, loadPrefs, loadDates, todayStr, ymOf, esc, activeActivities } from './state.js';
import { h, toast } from './ui.js';
import { renderAuth } from './views/auth.js';
import { renderMonth } from './views/month.js';
import { renderDay } from './views/day.js';
import { renderAdd } from './views/add.js';
import { renderNotes, renderNoteEditor } from './views/notes.js';
import { renderCounters } from './views/counters.js';
import { renderDates } from './views/dates.js';
import { renderThoughts } from './views/thoughts.js';
import { renderMe } from './views/me.js';
import { renderSearch } from './views/search.js';
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
  day: (p, q) => renderDay(p[1] || state.day || todayStr(), q),
  add: (p, q) => renderAdd(q),
  notes: (p) => (p[1] ? renderNoteEditor(Number(p[1])) : renderNotes()),
  counters: () => renderCounters(),
  dates: () => renderDates(),
  thoughts: () => renderThoughts(),
  me: () => renderMe(),
  search: (p, q) => renderSearch(q),
  activities: () => renderActivities(),
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
  const acts = activeActivities();
  const el = h(`<div class="menu"><div class="menu-in">
    <header class="hdr"><button class="hdr-btn" data-act="close" aria-label="закрыть">${I.close}</button><div class="hdr-title"><span>меню</span></div><button class="hdr-btn" data-act="search" aria-label="поиск">${I.search}</button></header>
    <div class="menu-block">
      <a class="mi" href="#/month">месяц ${I.calendar}</a>
      <a class="mi" href="#/day">день ${I.clock}</a>
    </div>
    <div class="menu-block">
      <a class="gear" href="#/activities" aria-label="настройки занятий">${I.gear}</a>
      ${acts.map((a) => `<span class="mi off" title="страница занятия — скоро">${esc(a.name)} <i class="dot" style="background:${a.color}"></i></span>`).join('')}
    </div>
    <div class="menu-block">
      <a class="mi" href="#/notes">заметки ${I.book}</a>
      <a class="mi" href="#/month?mode=food">еда ${I.apple}</a>
      <a class="mi" href="#/month?mode=tasks">задачи ${I.list}</a>
      <span class="mi off">деньги ${I.ruble}</span>
      <a class="mi" href="#/counters">счетчики ${I.timer}</a>
      <a class="mi" href="#/dates">важные даты ${I.star}</a>
      <a class="mi" href="#/thoughts">мысли ${I.cloud}</a>
    </div>
    <div class="menu-block">
      <a class="mi" href="#/me">я ${I.user}</a>
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

window.addEventListener('hashchange', route);
window.addEventListener('chronum:unauth', () => { if (ready) { ready = false; start(); } });
start();
