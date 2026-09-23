// Экран «день»: сетка часов 6×4, крошки-навигация, фильтры-наложения, блочная сводка, инфографика.
import { I, KIND_ICON, MOOD_ICON } from '../icons.js';
import {
  state, dayLabel, dotDate, todayStr, ymOf, loadDay, loadDates, hourMap, foodHeat, dayKcal, topCounter,
  isImportant, isSleepEvent, activity, tag, counter, MOOD_COLOR, hoursLabel, hoursRange, kcalNorm, grad, invalidateEvents,
} from '../state.js';
import { h, toast } from '../ui.js';
import { put } from '../api.js';
import {
  calHeader, dayPicker, filtersBar, activeFilters, cellRows, filterButton, sumLine, sumSep, hiddenInSummary,
  addBlock, selHeader, ROW_NEUTRAL,
} from './common.js';

export async function renderDay(day, query = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = todayStr();
  if (query.filter) state.filters.add(query.filter);
  state.day = day; state.month = ymOf(day);
  state.selection = new Set();
  const app = document.getElementById('app');
  document.body.classList.add('bg-day');
  const hdrHost = h('<div></div>');
  app.appendChild(hdrHost);
  const page = h('<div class="page cal"></div>');
  app.appendChild(page);
  // режим выбора часов: остается только сетка и блок «добавить»
  let selMode = false;
  // на десктопе слева часы с фильтрами, справа сводка дня
  let colL = null; let colR = null;

  const [evs] = await Promise.all([loadDay(day), loadDates().catch(() => null)]);
  const hm = hourMap(evs);
  const tasks = evs.filter((e) => e.kind === 'task');
  // задачи могут быть привязаны к часу — собираем их по часам для наложений
  const taskHours = Array.from({ length: 24 }, () => []);
  for (const t of tasks) for (const hr of t.hours || []) if (hr >= 0 && hr < 24) taskHours[hr].push(t);
  const isToday = day === todayStr();
  const nowHour = new Date().getHours();
  const tc = topCounter();
  const norm = kcalNorm();
  const imp = isImportant(day);

  function selectedHours() { return [...state.selection].sort((a, b) => a - b); }

  function exitSel() { selMode = false; state.selection.clear(); draw(); }

  function drawHeader() {
    hdrHost.innerHTML = '';
    if (selMode) {
      hdrHost.appendChild(selHeader({
        mid: `<span>${hoursRange(selectedHours())}</span><span class="sep">/</span><span>${dotDate(day)}</span>`,
        onClose: exitSel,
      }));
      return;
    }
    hdrHost.appendChild(calHeader({
      swapIcon: 'clock',
      swapTo: () => `#/month/${ymOf(day)}`,
      title: dayLabel(day),
      onTitle: () => dayPicker(day, (d) => { location.hash = `#/day/${d}`; }),
    }));
  }

  function draw() {
    document.body.classList.toggle('bg-hours', selMode);
    document.body.classList.toggle('bg-day', !selMode);
    drawHeader();
    page.innerHTML = '';
    const cols = h('<div class="cal-cols"></div>');
    colL = h('<div class="cal-l"></div>'); colR = h('<div class="cal-r"></div>');
    cols.append(colL, colR); page.appendChild(cols);
    const g = h('<div class="grid grid-day"></div>');
    for (let hr = 0; hr < 24; hr++) {
      const slot = hm[hr];
      const bottom = `<span class="cell-num">${hr}</span>${imp && hr === 0 ? `<span class="cell-star">${I.star}</span>` : ''}`;
      const { rows, html } = cellRows(overlays(slot, hr), bottom);
      const cell = h(`<button class="cell ${isToday && hr === nowHour ? 'today' : ''} ${state.selection.has(hr) ? 'selected' : ''}" style="--rows:${rows}" data-hour="${hr}">${html}</button>`);
      const act = slot.all.find((e) => e.kind === 'activity');
      if (act && isSleepEvent(act)) cell.classList.add('sleep');
      else if (act) { const a = activity(act.activity_id); if (a) { cell.style.background = grad(a.color); cell.classList.add('colored'); } }
      if (slot.extras.length) cell.classList.add('multi');
      cell.onclick = () => {
        if (!selMode) { selMode = true; state.selection = new Set([hr]); draw(); return; }
        if (state.selection.has(hr)) state.selection.delete(hr); else state.selection.add(hr);
        if (!state.selection.size) { selMode = false; }
        draw();
      };
      g.appendChild(cell);
    }
    colL.appendChild(g);
    if (selMode) {
      colL.appendChild(addBlock((kind) => {
        const back = encodeURIComponent(`#/day/${day}`);
        const hrs = selectedHours().join(',');
        location.hash = kind === 'task'
          ? `#/add?days=${day}&hours=${hrs}&kind=task&back=${back}`
          : `#/add?day=${day}&hours=${hrs}&kind=${kind}&back=${back}`;
      }));
      return;
    }
    colL.appendChild(filtersBar(() => draw()));

    drawActivities();
    for (const f of activeFilters()) {
      colR.appendChild(sumSep());
      if (f === 'food') drawFood();
      else if (f === 'counter') drawCounters();
      else if (f === 'task') drawTasks();
      else if (f === 'thought') drawThoughts();
    }
    drawGraph();
  }

  // наложения на ячейку часа
  function overlays(slot, hr) {
    const out = {};
    const foods = slot.all.filter((e) => e.kind === 'food');
    if (foods.length) {
      const kcal = Math.round(foods.reduce((s, e) => s + (e.kcal || 0), 0));
      // в представлении дня строка еды нейтральная, без цветовой оценки нормы
      out.food = { html: `<b>${kcal}</b>${icon('apple')}`, style: ROW_NEUTRAL };
    }
    if (tc) {
      const cs = slot.all.filter((e) => e.kind === 'counter' && e.counter_id === tc.id);
      if (cs.length) out.counter = { html: `<b>${Math.round(cs.reduce((s, e) => s + (e.counter_value || 0), 0) * 100) / 100}</b>${icon('timer')}`, style: ROW_NEUTRAL };
    }
    const th = slot.all.filter((e) => e.kind === 'thought').slice(0, 4);
    if (th.length) out.thought = { html: th.map((e) => `<span class="ri" style="color:${MOOD_COLOR[e.mood || 'neutral']}">${I[MOOD_ICON[e.mood || 'neutral']]}</span>`).join(''), style: ROW_NEUTRAL };
    // в индикаторе часа считаем только незавершённые задачи
    const tk = (taskHours[hr] || []).filter((e) => !e.done);
    if (tk.length) out.task = { html: `<b>${tk.length}</b>${icon('checkBox')}`, style: ROW_NEUTRAL };
    return out; // задачи без часа остаются только в сводке дня
  }
  function icon(name) { return `<span class="ri">${I[name]}</span>`; }

  function openEvent(e) {
    const back = encodeURIComponent(`#/day/${day}`);
    if (e.kind === 'task') location.hash = `#/add?days=${e.days.join(',')}&kind=task&edit=${e.id}&back=${back}`;
    else location.hash = `#/add?day=${e.day}&hours=${(e.hours || []).join(',')}&edit=${e.id}&back=${back}`;
  }

  function labelFor(e) {
    if (e.kind === 'activity') { const a = activity(e.activity_id); const tg = e.tag_id ? tag(e.tag_id) : null; return (e.text || '').trim() || [a?.name, tg?.name].filter(Boolean).join(' · ') || 'занятие'; }
    if (e.kind === 'counter') { const c = counter(e.counter_id); return `${c ? c.name : 'счётчик'}: ${e.counter_value}${c && c.unit ? ` ${c.unit}` : ''}`; }
    if (e.kind === 'food') return (e.text || '').trim() + (e.kcal != null ? ` — ${Math.round(e.kcal)} ккал` : '');
    return (e.text || '').trim();
  }
  function prefixFor(e) {
    if (e.kind === 'activity') { const a = activity(e.activity_id); return a ? `<i class="mood-dot" style="background:${a.color}"></i>` : ''; }
    if (e.kind === 'thought') return `<i class="mood-dot" style="background:${MOOD_COLOR[e.mood || 'neutral']}"></i>`;
    return `<span class="ico" style="display:inline-block;width:1.6rem;height:1.6rem;vertical-align:middle;margin-right:.6rem">${I[KIND_ICON[e.kind]]}</span>`;
  }

  function drawActivities() {
    const box = h('<div class="summary"></div>');
    // по умолчанию в сводке только занятия; остальные виды добавляются фильтрами
    const list = evs.filter((e) => e.kind === 'activity' && !hiddenInSummary(e) && !(isSleepEvent(e) && !(e.text || '').trim()))
      .sort((a, b) => (a.hours[0] - b.hours[0]) || (a.position - b.position));
    for (const e of list) box.appendChild(sumLine(hoursLabel(e.hours), labelFor(e), { files: (e.files || []).length, prefix: prefixFor(e), onClick: () => openEvent(e) }));
    if (!list.length) box.appendChild(h(`<p class="p">${state.hiddenActivities.size ? 'по выбранным занятиям в этот день ничего нет' : 'в этот день пока нет занятий\u00a0— нажмите на час, чтобы добавить запись'}</p>`));
    colR.appendChild(box);
  }

  function drawGraph() {
    const bar = h('<div class="infobar"></div>');
    bar.appendChild(filterButton(() => draw()));
    colR.appendChild(bar);
    const gEl = h('<div class="daygraph"></div>');
    for (let hr = 0; hr < 24; hr++) {
      const col = h(`<div class="col ${hr > 0 && hr % 6 === 0 ? 'sep' : ''}"></div>`);
      const items = hm[hr].all.filter((e) => !state.hiddenKinds.has(e.kind) && !(e.kind === 'activity' && isSleepEvent(e)));
      const mainAct = items.find((e) => e.kind === 'activity');
      const marks = [];
      if (mainAct) marks.push(`<i style="background:${grad(activity(mainAct.activity_id)?.color || '#DEDEDE', 135)}"></i>`);
      for (const e of items) {
        if (e === mainAct) continue;
        if (e.kind === 'activity') marks.push(`<i style="background:${grad(activity(e.activity_id)?.color || '#DEDEDE', 135)}"></i>`);
        else if (e.kind === 'thought') marks.push(`<span class="dk" style="color:${MOOD_COLOR[e.mood || 'neutral']}">${I[MOOD_ICON[e.mood || 'neutral']]}</span>`);
        else marks.push(`<span class="dk">${I[KIND_ICON[e.kind]]}</span>`);
      }
      if (!marks.length) marks.push('<i class="empty"></i>');
      const shown = marks.slice(0, 8);
      col.innerHTML = shown.join('') + (marks.length > 8 ? `<span class="more">+${marks.length - 8}</span>` : '');
      gEl.appendChild(col);
    }
    colR.appendChild(gEl);
  }

  function drawFood() {
    const k = dayKcal(evs);
    if (k) {
      const diff = Math.round(k.kcal - norm);
      colR.appendChild(h(`<div class="sum-head"><span><b>${k.kcal}</b> ккал</span><span class="muted">${diff >= 0 ? '+' : ''}${diff} к норме</span></div><div class="progress"><i style="width:${Math.min(100, Math.round(k.kcal / norm * 100))}%;background:${foodHeat(k.kcal)}"></i></div><p class="p">белки ${k.protein} · жиры ${k.fat} · углеводы ${k.carbs}</p>`));
    }
    const box = h('<div class="summary"></div>');
    const list = evs.filter((e) => e.kind === 'food').sort((a, b) => a.hours[0] - b.hours[0]);
    for (const e of list) box.appendChild(sumLine(hoursLabel(e.hours), labelFor(e), { files: (e.files || []).length, onClick: () => openEvent(e) }));
    if (!list.length) box.appendChild(h('<p class="p">еды в этот день не записано</p>'));
    colR.appendChild(box);
  }

  function drawCounters() {
    const box = h('<div class="summary"></div>');
    const sums = new Map();
    for (const e of evs) if (e.kind === 'counter' && e.counter_id) sums.set(e.counter_id, (sums.get(e.counter_id) || 0) + (e.counter_value || 0));
    for (const [id, sum] of sums) {
      const c = counter(id);
      box.appendChild(sumLine(c ? c.name : 'счётчик', `${Math.round(sum * 100) / 100}${c && c.unit ? ` ${c.unit}` : ''} за день`));
    }
    if (!sums.size) box.appendChild(h('<p class="p">записей счётчиков в этот день нет</p>'));
    colR.appendChild(box);
  }

  function drawThoughts() {
    const box = h('<div class="summary"></div>');
    const list = evs.filter((e) => e.kind === 'thought').sort((a, b) => a.hours[0] - b.hours[0]);
    for (const e of list) box.appendChild(sumLine(hoursLabel(e.hours), e.text || '', { prefix: prefixFor(e), onClick: () => openEvent(e) }));
    if (!list.length) box.appendChild(h('<p class="p">мыслей в этот день нет</p>'));
    colR.appendChild(box);
  }

  function drawTasks() {
    const done = tasks.filter((t) => t.done).length;
    colR.appendChild(h(`<div class="sum-head"><span><b>${tasks.length}</b> запланировано</span><span><b>${done}</b> сделано</span></div><div class="progress"><i style="width:${tasks.length ? Math.round(done / tasks.length * 100) : 0}%"></i></div>`));
    const box = h('<div class="summary"></div>');
    for (const tk of [...tasks].sort((a, b) => (a.done - b.done) || (a.position - b.position))) {
      const when = tk.days.length > 1 ? `${tk.days.length} дн.` : (tk.hours && tk.hours.length ? hoursLabel(tk.hours) : '·');
      const line = sumLine(when, tk.text || '(без текста)', { done: tk.done, prefix: prefixFor({ kind: 'activity', activity_id: tk.activity_id }) });
      line.querySelector('.t').onclick = async (ev) => { ev.stopPropagation(); try { await put(`/api/events/${tk.id}`, { done: !tk.done }); invalidateEvents(); tk.done = !tk.done; draw(); } catch (e) { toast(e.message); } };
      line.querySelector('.k').onclick = () => openEvent(tk);
      box.appendChild(line);
    }
    const addBtn = h('<button class="btn ghost wide">новая задача на этот день</button>');
    addBtn.onclick = () => { location.hash = `#/add?days=${day}&kind=task&back=${encodeURIComponent(`#/day/${day}`)}`; };
    box.appendChild(addBtn);
    colR.appendChild(box);
  }

  draw();
  return () => { document.querySelectorAll('.selbar').forEach((b) => b.remove()); document.body.classList.remove('bg-day', 'bg-hours'); };
}
