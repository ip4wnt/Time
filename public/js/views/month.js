// Экран «месяц»: сетка 7×6, крошки-навигация, фильтры-наложения, блочная сводка, инфографика.
import { I, KIND_ICON, MOOD_ICON } from '../icons.js';
import {
  state, monthGrid, todayStr, ymOf, loadMonth, loadDates, eventsOfDay, hourMap,
  dominantActivity, dayKcal, dayCounterValue, topCounter, isImportant, isSleepEvent,
  activity, tag, counter, esc, rangesLabel, MOOD_COLOR, MONTHS_FULL, WEEKDAYS, invalidateEvents, kcalNorm, grad,
} from '../state.js';
import { h, toast } from '../ui.js';
import { put } from '../api.js';
import {
  calHeader, monthPicker, filtersBar, activeFilters, cellRows, filterButton, sumLine, sumSep,
  ROW_NEUTRAL, ROW_OVER, ROW_UNDER,
} from './common.js';

export async function renderMonth(ym, query = {}) {
  if (!/^\d{4}-\d{2}$/.test(ym)) ym = ymOf(todayStr());
  if (query.filter) state.filters.add(query.filter);
  state.month = ym;
  const app = document.getElementById('app');
  document.body.classList.add('bg-month');
  const [y, m] = ym.split('-').map(Number);
  app.appendChild(calHeader({
    swapIcon: 'calendar',
    swapTo: () => `#/day/${state.day && ymOf(state.day) === ym ? state.day : (ymOf(todayStr()) === ym ? todayStr() : `${ym}-01`)}`,
    title: `${MONTHS_FULL[m - 1][0].toUpperCase()}${MONTHS_FULL[m - 1].slice(1)} ${y}`,
    onTitle: () => monthPicker(ym, (val) => { location.hash = `#/month/${val}`; }),
  }));
  const page = h('<div class="page cal"></div>');
  app.appendChild(page);

  const [events] = await Promise.all([loadMonth(ym), loadDates().catch(() => null)]);
  const grid = monthGrid(ym);
  const perDay = new Map(grid.map((g) => [g.date, eventsOfDay(events, g.date)]));
  const today = todayStr();
  const tc = topCounter();
  const norm = kcalNorm();
  // выбор дней для новой задачи (кнопка в конце блока задач)
  let pickDays = null;

  function draw() {
    page.innerHTML = '';
    page.appendChild(h(`<div class="weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>`));
    const g = h('<div class="grid grid-month"></div>');
    for (const info of grid) {
      const evs = perDay.get(info.date);
      const imp = isImportant(info.date);
      const bottom = `<span class="cell-num">${info.dom}</span>${imp ? `<span class="cell-star" title="${esc(imp.title)}">${I.star}</span>` : ''}`;
      const { rows, html } = cellRows(overlays(evs), bottom);
      const cell = h(`<button class="cell ${info.inMonth ? '' : 'out'} ${info.date === today ? 'today' : ''}" style="--rows:${rows}" data-day="${info.date}">${html}</button>`);
      const a = dominantActivity(evs);
      if (a) { cell.style.background = grad(a.color); cell.classList.add('colored'); }
      if (pickDays && pickDays.has(info.date)) cell.classList.add('selected');
      cell.onclick = () => {
        if (pickDays) {
          if (pickDays.has(info.date)) pickDays.delete(info.date); else pickDays.add(info.date);
          draw();
          return;
        }
        state.day = info.date; location.hash = `#/day/${info.date}`;
      };
      g.appendChild(cell);
    }
    page.appendChild(g);
    document.querySelectorAll('.selbar').forEach((b) => b.remove());
    if (pickDays) {
      const bar = h(`<div class="selbar"><button class="btn ghost" data-act="cancel">отменить</button><button class="btn" data-act="add" ${pickDays.size ? '' : 'disabled'}>добавить задачу</button></div>`);
      bar.querySelector('[data-act=cancel]').onclick = () => { pickDays = null; draw(); };
      bar.querySelector('[data-act=add]').onclick = () => {
        const days = [...pickDays].sort().join(',');
        location.hash = `#/add?days=${days}&kind=task&back=${encodeURIComponent(`#/month/${ym}`)}`;
      };
      document.body.appendChild(bar);
      return;
    }
    page.appendChild(filtersBar(() => draw()));

    drawActivitySummary();
    for (const f of activeFilters()) {
      page.appendChild(sumSep());
      if (f === 'food') drawFoodSummary();
      else if (f === 'counter') drawCounterSummary();
      else if (f === 'task') drawTasksSummary();
      else if (f === 'thought') drawThoughtsSummary();
    }
    drawInfographic();
  }

  // наложения на ячейку дня
  function overlays(evs) {
    const out = {};
    const k = dayKcal(evs);
    if (k) out.food = { html: `<b>${k.kcal}</b>${icon('apple')}`, style: k.kcal > norm ? ROW_OVER : ROW_UNDER };
    if (tc) { const v = dayCounterValue(evs, tc.id); if (v !== null) out.counter = { html: `<b>${v}</b>${icon('timer')}`, style: ROW_NEUTRAL }; }
    const tasks = evs.filter((e) => e.kind === 'task');
    if (tasks.length) out.task = { html: `<b>${tasks.length}</b>${icon('checkBox')}`, style: ROW_NEUTRAL };
    const th = evs.filter((e) => e.kind === 'thought').slice(0, 4);
    if (th.length) out.thought = { html: th.map((e) => `<span class="ri" style="color:${MOOD_COLOR[e.mood || 'neutral']}">${I[MOOD_ICON[e.mood || 'neutral']]}</span>`).join(''), style: ROW_NEUTRAL };
    return out;
  }
  function icon(name) { return `<span class="ri">${I[name]}</span>`; }

  // события ≥3 часов подряд, сгруппированные по занятие+тег+текст → дни
  function drawActivitySummary() {
    const groups = new Map();
    for (const g of grid) {
      if (!g.inMonth) continue;
      for (const e of perDay.get(g.date)) {
        if (e.kind !== 'activity' || isSleepEvent(e)) continue;
        if (!hasRun(e.hours || [], 3)) continue;
        const key = `${e.activity_id}|${e.tag_id || ''}|${(e.text || '').trim()}`;
        if (!groups.has(key)) groups.set(key, { e, days: [], files: 0 });
        const gr = groups.get(key); gr.days.push(g.dom); gr.files += (e.files || []).length;
      }
    }
    const box = h('<div class="summary"></div>');
    const list = [...groups.values()].sort((a, b) => a.days[0] - b.days[0]);
    for (const gr of list) {
      const a = activity(gr.e.activity_id); const tg = gr.e.tag_id ? tag(gr.e.tag_id) : null;
      const text = (gr.e.text || '').trim() || [a && a.name, tg && tg.name].filter(Boolean).join(' · ');
      box.appendChild(sumLine(rangesLabel(gr.days), text, { files: gr.files, onClick: () => openEvent(gr.e) }));
    }
    if (!list.length) box.appendChild(h('<p class="p">в этом месяце пока нет занятий от трёх часов подряд</p>'));
    page.appendChild(box);
  }

  function drawInfographic() {
    const bar = h('<div class="infobar"></div>');
    bar.appendChild(filterButton(() => draw()));
    bar.appendChild(h(`<span class="muted" style="font-size:1.5rem">${state.sort === 'weight' ? 'по весу' : 'по времени'}${state.hiddenKinds.size ? ` · скрыто: ${state.hiddenKinds.size}` : ''}</span>`));
    page.appendChild(bar);
    const items = [];
    for (const g of grid) {
      if (!g.inMonth) continue;
      const hm = hourMap(perDay.get(g.date));
      for (let hIdx = 0; hIdx < 24; hIdx++) {
        const acts = hm[hIdx].all;
        const mainAct = acts.find((x) => x.kind === 'activity');
        for (const e of acts) {
          if (state.hiddenKinds.has(e.kind)) continue;
          if (e.kind === 'activity') { if (e !== mainAct || isSleepEvent(e)) continue; items.push({ t: g.dom * 24 + hIdx, color: activity(e.activity_id)?.color || '#DEDEDE', kind: 'activity', id: e.activity_id }); }
          else items.push({ t: g.dom * 24 + hIdx, kind: e.kind, mood: e.mood });
        }
      }
      for (const e of perDay.get(g.date)) if (e.kind === 'task' && !state.hiddenKinds.has('task')) items.push({ t: g.dom * 24, kind: 'task', color: activity(e.activity_id)?.color, done: e.done });
    }
    let ordered;
    if (state.sort === 'chrono') ordered = items.sort((a, b) => a.t - b.t);
    else {
      const cnt = new Map();
      for (const it of items) { const k = it.kind === 'activity' ? `a${it.id}` : it.kind; cnt.set(k, (cnt.get(k) || 0) + 1); }
      ordered = items.sort((a, b) => { const ka = a.kind === 'activity' ? `a${a.id}` : a.kind, kb = b.kind === 'activity' ? `a${b.id}` : b.kind; return (cnt.get(kb) - cnt.get(ka)) || ka.localeCompare(kb) || (a.t - b.t); });
    }
    const dots = h('<div class="dots"></div>');
    for (const it of ordered) {
      if (it.kind === 'activity') dots.appendChild(h(`<i style="background:${grad(it.color, 135)}"></i>`));
      else if (it.kind === 'task') dots.appendChild(h(`<span class="dk" style="color:${it.color || '#fff'}">${it.done ? I.check : I.list}</span>`));
      else if (it.kind === 'thought') dots.appendChild(h(`<span class="dk" style="color:${MOOD_COLOR[it.mood || 'neutral']}">${I[MOOD_ICON[it.mood || 'neutral']]}</span>`));
      else dots.appendChild(h(`<span class="dk">${I[KIND_ICON[it.kind]]}</span>`));
    }
    if (!ordered.length) dots.appendChild(h('<span class="muted" style="grid-column:1/-1;font-size:1.5rem">пусто</span>'));
    page.appendChild(dots);
  }

  function drawFoodSummary() {
    const box = h('<div class="summary"></div>');
    let any = false;
    for (const g of grid) {
      if (!g.inMonth) continue;
      const k = dayKcal(perDay.get(g.date)); if (!k) continue; any = true;
      const diff = Math.round(k.kcal - norm);
      const line = h(`<button class="food-line"><span class="k">${g.dom}</span><span><span class="kcal"><b>${k.kcal}</b> ккал <small>${diff >= 0 ? '+' : ''}${diff} к норме</small></span> <span class="macro">Б ${k.protein} · Ж ${k.fat} · У ${k.carbs}</span></span></button>`);
      line.onclick = () => { const e = perDay.get(g.date).find((x) => x.kind === 'food'); if (e) openEvent(e); };
      box.appendChild(line);
    }
    if (!any) box.appendChild(h('<p class="p">записей о еде в этом месяце нет</p>'));
    page.appendChild(box);
  }

  function drawCounterSummary() {
    const box = h('<div class="summary"></div>');
    const sums = new Map();
    for (const g of grid) {
      if (!g.inMonth) continue;
      for (const e of perDay.get(g.date)) if (e.kind === 'counter' && e.counter_id) sums.set(e.counter_id, (sums.get(e.counter_id) || 0) + (e.counter_value || 0));
    }
    for (const [id, sum] of sums) {
      const c = counter(id);
      box.appendChild(sumLine(c ? c.name : 'счётчик', `${Math.round(sum * 100) / 100}${c && c.unit ? ` ${c.unit}` : ''} в этом месяце`));
    }
    if (!sums.size) box.appendChild(h('<p class="p">записей счётчиков в этом месяце нет</p>'));
    page.appendChild(box);
  }

  function drawTasksSummary() {
    const tasks = [];
    const seen = new Set();
    for (const g of grid) for (const e of perDay.get(g.date)) if (e.kind === 'task' && !seen.has(e.id) && (e.days || []).some((d) => d.startsWith(ym))) { seen.add(e.id); tasks.push(e); }
    const done = tasks.filter((t) => t.done).length;
    page.appendChild(h(`<div class="sum-head"><span><b>${tasks.length}</b> запланировано</span><span><b>${done}</b> сделано</span></div><div class="progress"><i style="width:${tasks.length ? Math.round(done / tasks.length * 100) : 0}%"></i></div>`));
    const box = h('<div class="summary"></div>');
    tasks.sort((a, b) => (a.done - b.done) || (a.days[0] < b.days[0] ? -1 : 1) || (a.position - b.position));
    for (const t of tasks) {
      const a = t.activity_id ? activity(t.activity_id) : null;
      const days = rangesLabel(t.days.filter((d) => d.startsWith(ym)).map((d) => Number(d.slice(8))));
      const line = sumLine(days, t.text || '(без текста)', { done: t.done, files: (t.files || []).length, prefix: a ? `<i class="mood-dot" style="background:${a.color}"></i>` : '' });
      line.querySelector('.t').onclick = async (ev) => {
        ev.stopPropagation();
        try { await put(`/api/events/${t.id}`, { done: !t.done }); invalidateEvents(); t.done = !t.done; for (const [, list] of perDay) { const x = list.find((y2) => y2.id === t.id); if (x) x.done = t.done; } draw(); }
        catch (e) { toast(e.message); }
      };
      line.querySelector('.k').onclick = () => openEvent(t);
      box.appendChild(line);
    }
    if (!tasks.length) box.appendChild(h('<p class="p">задач на этот месяц нет</p>'));
    const addBtn = h(`<button class="newtask">${I.plus}<span>новая задача</span></button>`);
    addBtn.onclick = () => { pickDays = new Set(); draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    box.appendChild(addBtn);
    page.appendChild(box);
  }

  function drawThoughtsSummary() {
    const box = h('<div class="summary"></div>');
    let any = false;
    for (const g of grid) {
      if (!g.inMonth) continue;
      for (const e of perDay.get(g.date)) {
        if (e.kind !== 'thought') continue; any = true;
        box.appendChild(sumLine(String(g.dom), e.text || '', { prefix: `<i class="mood-dot" style="background:${MOOD_COLOR[e.mood || 'neutral']}"></i>`, onClick: () => openEvent(e) }));
      }
    }
    if (!any) box.appendChild(h('<p class="p">мыслей в этом месяце нет</p>'));
    page.appendChild(box);
  }

  function openEvent(e, backTo) {
    const back = encodeURIComponent(backTo || `#/month/${ym}`);
    if (e.kind === 'task') location.hash = `#/add?days=${e.days.join(',')}&kind=task&edit=${e.id}&back=${back}`;
    else location.hash = `#/add?day=${e.day}&hours=${(e.hours || []).join(',')}&edit=${e.id}&back=${back}`;
  }

  draw();
  return () => { document.querySelectorAll('.selbar').forEach((b) => b.remove()); document.body.classList.remove('bg-month'); };
}

function hasRun(hours, n) {
  const a = [...hours].sort((x, y) => x - y);
  let run = 1;
  for (let i = 1; i < a.length; i++) { run = a[i] === a[i - 1] + 1 ? run + 1 : 1; if (run >= n) return true; }
  return false;
}
