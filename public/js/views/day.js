// Экран «день»: сетка часов 6×4, выделение часов, саммари, инфографика.
import { I, KIND_ICON, MOOD_ICON } from '../icons.js';
import {
  state, dayTitle, addDays, todayStr, ymOf, loadDay, loadDates, hourMap, foodHeat, dayKcal, dayCounterValue, topCounter,
  isImportant, isSleepEvent, activity, tag, counter, esc, MOOD_COLOR, isLight, hoursLabel, kcalNorm,
} from '../state.js';
import { h, header, toast } from '../ui.js';
import { put } from '../api.js';
import { invalidateEvents } from '../state.js';
import { modesBar, calNav, filterButton, sumLine, MODE_KIND } from './common.js';

export async function renderDay(day, query = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = todayStr();
  if (query.mode) state.mode = query.mode;
  state.day = day; state.month = ymOf(day);
  state.selection = new Set();
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'день', icon: 'clock' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);

  const [evs] = await Promise.all([loadDay(day), loadDates().catch(() => null)]);
  const hm = hourMap(evs);
  const tasks = evs.filter((e) => e.kind === 'task');
  const isToday = day === todayStr();
  const nowHour = new Date().getHours();
  const tc = topCounter();

  function draw() {
    page.innerHTML = '';
    const g = h('<div class="grid grid-day"></div>');
    for (let hr = 0; hr < 24; hr++) {
      const slot = hm[hr];
      const cell = h(`<button class="cell ${isToday && hr === nowHour ? 'today' : ''} ${state.selection.has(hr) ? 'selected' : ''}" data-hour="${hr}"><span class="cell-num">${hr}</span></button>`);
      let color = null;
      const mainAct = slot.all.find((e) => e.kind === 'activity');
      if (state.mode === 'activities') {
        if (slot.main) {
          if (slot.main.kind === 'activity') color = activity(slot.main.activity_id)?.color || null;
          else if (slot.main.kind === 'thought') color = MOOD_COLOR[slot.main.mood || 'neutral'];
          else if (mainAct) color = activity(mainAct.activity_id)?.color || null;
        }
        if (slot.extras.length) cell.appendChild(h(`<span class="cell-more">+${slot.extras.length}</span>`));
        if (state.counterOn && tc) { const cs = slot.all.filter((e) => e.kind === 'counter' && e.counter_id === tc.id); if (cs.length) cell.appendChild(h(`<span class="cell-counter">${cs.reduce((s, e) => s + (e.counter_value || 0), 0)}${I.timer}</span>`)); }
      } else if (state.mode === 'food') {
        const foods = slot.all.filter((e) => e.kind === 'food');
        if (foods.length) { cell.appendChild(h(`<span class="cell-mark">${I.apple}</span>`)); color = '#1c2a1e'; }
        if (foods.length > 1) cell.appendChild(h(`<span class="cell-more">+${foods.length - 1}</span>`));
      } else if (state.mode === 'thoughts') {
        const th = slot.all.filter((e) => e.kind === 'thought');
        if (th.length) color = MOOD_COLOR[th[0].mood || 'neutral'];
        if (th.length > 1) cell.appendChild(h(`<span class="cell-more">+${th.length - 1}</span>`));
      } else if (state.mode === 'tasks') {
        // задачи привязаны к дню, не к часу — часы серые, но выделять можно (задача создастся на день)
      }
      if (color) { cell.style.background = color; if (isLight(color)) cell.style.color = '#000'; }
      cell.onclick = () => { if (state.selection.has(hr)) state.selection.delete(hr); else state.selection.add(hr); draw(); };
      g.appendChild(cell);
    }
    page.appendChild(g);

    const t = dayTitle(day);
    const imp = isImportant(day);
    page.appendChild(calNav({
      title: `<b>${t.dom}</b><span>${t.mon}</span>${imp ? `<span class="ico" style="width:2.2rem;height:2.2rem;color:#fff;align-self:center">${I.starFill}</span>` : ''}`,
      up: () => { location.hash = `#/month/${ymOf(day)}`; },
      prev: () => { location.hash = `#/day/${addDays(day, -1)}`; },
      next: () => { location.hash = `#/day/${addDays(day, 1)}`; },
      down: () => {}, downDisabled: true,
    }));
    page.appendChild(modesBar(() => { state.selection.clear(); draw(); }));

    if (state.mode === 'tasks') drawTasks();
    else if (state.mode === 'food') drawFood();
    else if (state.mode === 'thoughts') drawThoughts();
    else drawActivities();

    document.querySelectorAll('.selbar').forEach((b) => b.remove());
    if (state.selection.size) {
      const bar = h(`<div class="selbar"><button class="btn ghost" data-act="cancel">отменить</button><button class="btn" data-act="fill">заполнить</button></div>`);
      bar.querySelector('[data-act=cancel]').onclick = () => { state.selection.clear(); draw(); };
      bar.querySelector('[data-act=fill]').onclick = () => {
        const kind = MODE_KIND[state.mode] || 'activity';
        const back = encodeURIComponent(`#/day/${day}`);
        if (kind === 'task') location.hash = `#/add?days=${day}&kind=task&back=${back}`;
        else location.hash = `#/add?day=${day}&hours=${[...state.selection].sort((a, b) => a - b).join(',')}&kind=${kind}&back=${back}`;
      };
      document.body.appendChild(bar);
    }
  }

  function openEvent(e) {
    const back = encodeURIComponent(`#/day/${day}`);
    if (e.kind === 'task') location.hash = `#/add?days=${e.days.join(',')}&kind=task&edit=${e.id}&back=${back}`;
    else location.hash = `#/add?day=${e.day}&hours=${(e.hours || []).join(',')}&edit=${e.id}&back=${back}`;
  }

  function labelFor(e) {
    if (e.kind === 'activity') { const a = activity(e.activity_id); const tg = e.tag_id ? tag(e.tag_id) : null; return (e.text || '').trim() || [a?.name, tg?.name].filter(Boolean).join(' · ') || 'занятие'; }
    if (e.kind === 'counter') { const c = counter(e.counter_id); return `${c ? c.name : 'счётчик'}: ${e.counter_value}${c && c.unit ? ' ' + c.unit : ''}`; }
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
    const list = evs.filter((e) => e.kind !== 'task' && !(e.kind === 'activity' && isSleepEvent(e) && !(e.text || '').trim()))
      .sort((a, b) => (a.hours[0] - b.hours[0]) || (a.position - b.position));
    for (const e of list) box.appendChild(sumLine(hoursLabel(e.hours), labelFor(e), { files: (e.files || []).length, prefix: prefixFor(e), onClick: () => openEvent(e) }));
    if (tasks.length) for (const tk of tasks) box.appendChild(sumLine('задача', tk.text || '', { done: tk.done, prefix: prefixFor({ kind: 'activity', activity_id: tk.activity_id }), onClick: () => openEvent(tk) }));
    if (!list.length && !tasks.length) box.appendChild(h('<p class="p">в этот день пока ничего не записано — выделите часы и нажмите «заполнить»</p>'));
    page.appendChild(box);
    drawGraph();
  }

  function drawGraph() {
    const bar = h('<div class="infobar"></div>');
    bar.appendChild(filterButton(() => draw()));
    page.appendChild(bar);
    const gEl = h('<div class="daygraph"></div>');
    for (let hr = 0; hr < 24; hr++) {
      const col = h(`<div class="col ${hr > 0 && hr % 6 === 0 ? 'sep' : ''}"></div>`);
      const items = hm[hr].all.filter((e) => !state.hiddenKinds.has(e.kind) && !(e.kind === 'activity' && isSleepEvent(e)));
      const mainAct = items.find((e) => e.kind === 'activity');
      const marks = [];
      if (mainAct) marks.push(`<i style="background:${activity(mainAct.activity_id)?.color || '#DEDEDE'}"></i>`);
      for (const e of items) {
        if (e === mainAct) continue;
        if (e.kind === 'activity') marks.push(`<i style="background:${activity(e.activity_id)?.color || '#DEDEDE'}"></i>`);
        else if (e.kind === 'thought') marks.push(`<span class="dk" style="color:${MOOD_COLOR[e.mood || 'neutral']}">${I[MOOD_ICON[e.mood || 'neutral']]}</span>`);
        else marks.push(`<span class="dk">${I[KIND_ICON[e.kind]]}</span>`);
      }
      if (!marks.length) marks.push('<i class="empty"></i>');
      const shown = marks.slice(0, 8);
      col.innerHTML = shown.join('') + (marks.length > 8 ? `<span class="more">+${marks.length - 8}</span>` : '');
      gEl.appendChild(col);
    }
    page.appendChild(gEl);
  }

  function drawFood() {
    const k = dayKcal(evs);
    if (k) {
      const diff = Math.round(k.kcal - kcalNorm());
      page.appendChild(h(`<div class="sum-head"><span><b>${k.kcal}</b> ккал</span><span class="muted">${diff >= 0 ? '+' : ''}${diff} к норме</span></div><div class="progress"><i style="width:${Math.min(100, Math.round(k.kcal / kcalNorm() * 100))}%;background:${foodHeat(k.kcal)}"></i></div><p class="p">белки ${k.protein} · жиры ${k.fat} · углеводы ${k.carbs}</p>`));
    }
    const box = h('<div class="summary"></div>');
    const list = evs.filter((e) => e.kind === 'food').sort((a, b) => a.hours[0] - b.hours[0]);
    for (const e of list) box.appendChild(sumLine(hoursLabel(e.hours), labelFor(e), { files: (e.files || []).length, onClick: () => openEvent(e) }));
    if (!list.length) box.appendChild(h('<p class="p">еды в этот день не записано — выделите час и нажмите «заполнить»</p>'));
    page.appendChild(box);
  }

  function drawThoughts() {
    const box = h('<div class="summary"></div>');
    const list = evs.filter((e) => e.kind === 'thought').sort((a, b) => a.hours[0] - b.hours[0]);
    for (const e of list) box.appendChild(sumLine(hoursLabel(e.hours), e.text || '', { prefix: prefixFor(e), onClick: () => openEvent(e) }));
    if (!list.length) box.appendChild(h('<p class="p">мыслей в этот день нет</p>'));
    page.appendChild(box);
  }

  function drawTasks() {
    const done = tasks.filter((t) => t.done).length;
    page.appendChild(h(`<div class="sum-head"><span><b>${tasks.length}</b> запланировано</span><span><b>${done}</b> сделано</span></div><div class="progress"><i style="width:${tasks.length ? Math.round(done / tasks.length * 100) : 0}%"></i></div>`));
    const box = h('<div class="summary"></div>');
    for (const tk of [...tasks].sort((a, b) => (a.done - b.done) || (a.position - b.position))) {
      const line = sumLine(tk.days.length > 1 ? `${tk.days.length} дн.` : '·', tk.text || '(без текста)', { done: tk.done, prefix: prefixFor({ kind: 'activity', activity_id: tk.activity_id }) });
      line.querySelector('.t').onclick = async (ev) => { ev.stopPropagation(); try { await put(`/api/events/${tk.id}`, { done: !tk.done }); invalidateEvents(); tk.done = !tk.done; draw(); } catch (e) { toast(e.message); } };
      line.querySelector('.k').onclick = () => openEvent(tk);
      box.appendChild(line);
    }
    if (!tasks.length) box.appendChild(h('<p class="p">на этот день задач нет — выделите любой час и нажмите «заполнить»</p>'));
    page.appendChild(box);
  }

  draw();
  return () => { document.querySelectorAll('.selbar').forEach((b) => b.remove()); };
}
