// Общее состояние приложения и вспомогательные функции по датам/цветам/событиям.
import { get, post } from './api.js';

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const WEEKDAYS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
export const MOOD_COLOR = { sad: '#476FAF', neutral: '#686868', happy: '#F2D96B' };
export const KINDS = ['activity', 'food', 'task', 'money', 'thought', 'counter'];

export const state = {
  user: null,
  activities: [],
  tags: [],
  counters: [],
  events: new Map(), // 'YYYY-MM' → массив событий
  dates: null,       // важные даты (кэш)
  mode: 'activities', // activities | food | tasks | thoughts
  counterOn: false,
  sort: 'weight',     // weight | chrono
  hiddenKinds: new Set(),
  month: null,        // 'YYYY-MM'
  day: null,          // 'YYYY-MM-DD' — последний выбранный/просмотренный день
  selection: new Set(),
  menuOpen: false,
};

// ---------- даты ----------
export const pad = (n) => String(n).padStart(2, '0');
export function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function ymOf(dateStr) { return dateStr.slice(0, 7); }
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
export function addMonths(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
export function monthGrid(ym) {
  // 42 дня начиная с понедельника недели, содержащей 1-е число
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const shift = (first.getDay() + 6) % 7;
  const start = new Date(y, m - 1, 1 - shift);
  const out = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); out.push({ date: fmtDate(d), inMonth: d.getMonth() === m - 1, dom: d.getDate() }); }
  return out;
}
export function monthTitle(ym) { const [y, m] = ym.split('-').map(Number); return { mon: MONTHS_SHORT[m - 1], year: String(y).slice(2) }; }
export function dayTitle(s) { const d = parseDate(s); return { dom: d.getDate(), mon: MONTHS_SHORT[d.getMonth()], year: String(d.getFullYear()).slice(2) }; }
export function humanDate(s) { const d = parseDate(s); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; }

// "1,3-5,9" из массива чисел
export function rangesLabel(nums) {
  const a = [...new Set(nums)].sort((x, y) => x - y);
  const parts = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    parts.push(j - i >= 1 ? (j - i === 1 ? `${a[i]},${a[j]}` : `${a[i]}-${a[j]}`) : `${a[i]}`);
    i = j + 1;
  }
  return parts.join(',');
}
export function hoursLabel(hours) {
  // как на макете: «10», «19-21» (часы подряд), «18,22» (разные часы)
  const a = [...hours].sort((x, y) => x - y);
  if (!a.length) return '';
  const runs = [];
  let i = 0;
  while (i < a.length) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; runs.push(j > i ? `${a[i]}-${a[j]}` : `${a[i]}`); i = j + 1; }
  return runs.join(',');
}
// формат экрана добавления, как на макете: «12.0-13.0» — начало первого и конец последнего часа
export function hoursRange(hours) {
  const a = [...hours].sort((x, y) => x - y);
  if (!a.length) return '';
  const runs = [];
  let i = 0;
  while (i < a.length) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; runs.push(`${a[i]}.0-${a[j] + 1}.0`); i = j + 1; }
  return runs.join(', ');
}

// ---------- цвета ----------
export function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 186;
}
export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- справочники ----------
export function activity(id) { return state.activities.find((a) => a.id === Number(id)) || null; }
export function tag(id) { return state.tags.find((t) => t.id === Number(id)) || null; }
export function counter(id) { return state.counters.find((c) => c.id === Number(id)) || null; }
export function topCounter() { return state.counters[0] || null; }
export function activeActivities() { return state.activities.filter((a) => !a.archived); }
export function eventColor(e) {
  if (e.kind === 'thought') return MOOD_COLOR[e.mood || 'neutral'];
  if (e.kind === 'food') return '#73D383';
  if (e.kind === 'counter') return '#DEDEDE';
  const a = e.activity_id ? activity(e.activity_id) : null;
  return a ? a.color : null;
}
export function isSleepEvent(e) { const a = e.activity_id ? activity(e.activity_id) : null; return !!(a && a.is_sleep); }

export async function loadBootstrap() {
  const b = await get('/api/bootstrap');
  state.user = b.user; state.activities = b.activities; state.tags = b.tags; state.counters = b.counters;
  return b;
}

// ---------- события ----------
export function invalidateEvents() { state.events.clear(); }

export async function loadMonth(ym) {
  if (state.events.has(ym)) return state.events.get(ym);
  const days = daysInMonth(ym);
  // с запасом: сетка месяца показывает соседние дни
  const from = addDays(`${ym}-01`, -7), to = addDays(`${ym}-${pad(days)}`, 14);
  const r = await get(`/api/events?from=${from}&to=${to}`);
  state.events.set(ym, r.events);
  return r.events;
}
export async function loadDay(day) {
  const evs = await loadMonth(ymOf(day));
  return eventsOfDay(evs, day);
}
export function eventsOfDay(events, day) {
  return events.filter((e) => (e.kind === 'task' ? (e.days || []).includes(day) : e.day === day)).sort(byOrder);
}
export function byOrder(a, b) { return (a.position - b.position) || (a.id - b.id); }

// часы дня: [{main, extras, all}] × 24; в main — событие с наименьшей позицией (сон учитывается как обычное занятие)
export function hourMap(dayEvents) {
  const hours = Array.from({ length: 24 }, () => []);
  for (const e of dayEvents) if (e.kind !== 'task') for (const h of e.hours || []) hours[h].push(e);
  return hours.map((list) => { list.sort(byOrder); return { all: list, main: list[0] || null, extras: list.slice(1) }; });
}

// доминирующее занятие дня (без сна): по числу часов, где занятие — основное
export function dominantActivity(dayEvents) {
  const hm = hourMap(dayEvents);
  const cnt = new Map();
  for (const h of hm) {
    const e = h.all.find((x) => x.kind === 'activity');
    if (!e || isSleepEvent(e) || !e.activity_id) continue;
    cnt.set(e.activity_id, (cnt.get(e.activity_id) || 0) + 1);
  }
  let best = null;
  for (const [id, n] of cnt) if (!best || n > best.n) best = { id, n };
  return best ? activity(best.id) : null;
}
export function dominantMood(dayEvents) {
  const cnt = {};
  for (const e of dayEvents) if (e.kind === 'thought') cnt[e.mood || 'neutral'] = (cnt[e.mood || 'neutral'] || 0) + 1;
  let best = null;
  for (const [m, n] of Object.entries(cnt)) if (!best || n > best.n) best = { m, n };
  return best ? best.m : null;
}
export function dayKcal(dayEvents) {
  let kcal = 0, p = 0, f = 0, c = 0, any = false;
  for (const e of dayEvents) if (e.kind === 'food') { any = true; kcal += e.kcal || 0; p += e.protein || 0; f += e.fat || 0; c += e.carbs || 0; }
  return any ? { kcal: Math.round(kcal), protein: Math.round(p), fat: Math.round(f), carbs: Math.round(c) } : null;
}
export function kcalNorm() { return Number((state.user && state.user.settings && state.user.settings.kcal_norm) || 2000); }
export function foodHeat(kcal) {
  const norm = kcalNorm();
  const d = kcal - norm;
  if (d >= 300) return '#7A1010';
  if (d >= 200) return '#C62C22';
  if (d >= 100) return '#E07070';
  if (d <= -300) return '#D6F5DD';
  if (d <= -100) return '#A8E6B5';
  return '#73D383';
}
export function dayCounterValue(dayEvents, counterId) {
  let sum = 0, any = false;
  for (const e of dayEvents) if (e.kind === 'counter' && e.counter_id === counterId) { sum += e.counter_value || 0; any = true; }
  return any ? Math.round(sum * 100) / 100 : null;
}

// ---------- важные даты ----------
export async function loadDates(force = false) {
  if (state.dates && !force) return state.dates;
  const r = await get('/api/dates');
  state.dates = r.dates;
  return state.dates;
}
export function isImportant(day) {
  if (!state.dates) return null;
  const mmdd = day.slice(5);
  return state.dates.find((d) => d.day === day || (d.yearly && d.day.slice(5) === mmdd)) || null;
}

// ---------- сохранение ----------
export async function saveBatch(upsert, del) {
  const r = await post('/api/events/batch', { upsert, delete: del });
  invalidateEvents();
  return r.events;
}

// ---------- настройки ----------
export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('chronum_prefs') || '{}');
    if (p.mode) state.mode = p.mode;
    if (p.sort) state.sort = p.sort;
    if (p.counterOn) state.counterOn = true;
    if (Array.isArray(p.hiddenKinds)) state.hiddenKinds = new Set(p.hiddenKinds);
  } catch { /* ignore */ }
}
export function savePrefs() {
  try { localStorage.setItem('chronum_prefs', JSON.stringify({ mode: state.mode, sort: state.sort, counterOn: state.counterOn, hiddenKinds: [...state.hiddenKinds] })); } catch { /* ignore */ }
}

// ---------- утилиты ----------
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function fmtSize(n) { if (n < 1024) return `${n} Б`; if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`; return `${(n / 1024 / 1024).toFixed(1)} МБ`; }
export function fmtTime(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function firstLine(text, max = 60) { const s = String(text || '').split('\n').find((l) => l.trim()) || ''; return s.length > max ? s.slice(0, max - 1) + '…' : s; }
