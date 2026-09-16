// Экран «месяц»: сетка 7×6, навигация, режимы, саммари, инфографика.
import { I, KIND_ICON, MOOD_ICON } from '../icons.js';
import {
  state, monthGrid, monthTitle, addMonths, todayStr, ymOf, loadMonth, loadDates, eventsOfDay, hourMap,
  dominantActivity, dominantMood, dayKcal, foodHeat, dayCounterValue, topCounter, isImportant, isSleepEvent,
  activity, tag, esc, rangesLabel, MOOD_COLOR, WEEKDAYS, isLight, invalidateEvents, kcalNorm,
} from '../state.js';
import { h, header, toast } from '../ui.js';
import { put } from '../api.js';
import { modesBar, calNav, filterButton, sumLine } from './common.js';

export async function renderMonth(ym, query = {}) {
  if (!/^\d{4}-\d{2}$/.test(ym)) ym = ymOf(todayStr());
  if (query.mode) state.mode = query.mode;
  state.month = ym;
  state.selection = new Set();
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'месяц', icon: 'calendar' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);

  const [events] = await Promise.all([loadMonth(ym), loadDates().catch(() => null)]);
  const grid = monthGrid(ym);
  const perDay = new Map(grid.map((g) => [g.date, eventsOfDay(events, g.date)]));
  const today = todayStr();
  const tc = topCounter();

  function draw() {
    page.innerHTML = '';
    // --- дни недели + сетка
    page.appendChild(h(`<div class="weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>`));
    const g = h('<div class="grid grid-month"></div>');
    for (const cellInfo of grid) {
      const evs = perDay.get(cellInfo.date);
      const cell = h(`<button class="cell ${cellInfo.inMonth ? '' : 'out'} ${cellInfo.date === today ? 'today' : ''}" data-day="${cellInfo.date}"><span class="cell-num">${cellInfo.dom}</span></button>`);
      let color = null;
      if (state.mode === 'activities') {
        const a = dominantActivity(evs); if (a) color = a.color;
        if (state.counterOn && tc) { const v = dayCounterValue(evs, tc.id); if (v !== null) cell.appendChild(h(`<span class="cell-counter">${v}${I.timer}</span>`)); }
      } else if (state.mode === 'food') {
        const k = dayKcal(evs); if (k) color = foodHeat(k.kcal);
      } else if (state.mode === 'tasks') {
        const tasks = evs.filter((e) => e.kind === 'task');
        if (tasks.length) {
          const t = tasks.find((x) => !x.done) || tasks[0];
          const a = t.activity_id ? activity(t.activity_id) : null;
          color = a ? a.color : '#DEDEDE';
          if (tasks.every((x) => x.done)) cell.appendChild(h(`<span class="cell-mark">${I.check}</span>`));
          if (tasks.length > 1) cell.appendChild(h(`<span class="cell-more">+${tasks.length - 1}</span>`));
        }
        if (state.selection.has(cellInfo.date)) cell.classList.add('selected');
      } else if (state.mode === 'thoughts') {
        const m = dominantMood(evs); if (m) color = MOOD_COLOR[m];
      }
      if (color) { cell.style.background = color; cell.classList.add('colored'); if (isLight(color)) cell.style.color = '#000'; }
      const imp = isImportant(cellInfo.date);
      if (imp) cell.appendChild(h(`<span class="cell-star" title="${esc(imp.title)}">${I.starFill}</span>`));
      cell.onclick = () => onCell(cellInfo.date);
      g.appendChild(cell);
    }
    page.appendChild(g);

    // --- навигация
    const t = monthTitle(ym);
    page.appendChild(calNav({
      title: `<b>${t.mon}</b><span>${t.year}</span>`,
      up: () => {}, upDisabled: true,
      prev: () => { location.hash = `#/month/${addMonths(ym, -1)}`; },
      next: () => { location.hash = `#/month/${addMonths(ym, 1)}`; },
      down: () => { const d = state.day && ymOf(state.day) === ym ? state.day : (ymOf(today) === ym ? today : `${ym}-01`); location.hash = `#/day/${d}`; },
    }));
    page.appendChild(modesBar(() => { state.selection.clear(); draw(); }));

    // --- саммари по режиму
    if (state.mode === 'activities') drawActivitySummary();
    else if (state.mode === 'food') drawFoodSummary();
    else if (state.mode === 'tasks') drawTasksSummary();
    else if (state.mode === 'thoughts') drawThoughtsSummary();

    // --- нижняя панель выбора (режим задач)
    document.querySelectorAll('.selbar').forEach((b) => b.remove());
    if (state.mode === 'tasks' && state.selection.size) {
      const bar = h('<div class="selbar"></div>');

      // задачи выделенных дней — чтобы открыть уже созданную, а не только добавить новую
      const picked = [];
      const seenIds = new Set();
      for (const day of [...state.selection].sort()) {
        for (const e of perDay.get(day) || []) {
          if (e.kind !== 'task' || seenIds.has(e.id)) continue;
          seenIds.add(e.id); picked.push(e);
        }
      }
      if (picked.length) {
        bar.classList.add('with-list');
        const list = h('<div class="selbar-list"></div>');
        picked.sort((a, b) => (a.done - b.done) || (a.days[0] < b.days[0] ? -1 : 1) || (a.position - b.position));
        for (const t of picked) {
          const a = t.activity_id ? activity(t.activity_id) : null;
          const days = rangesLabel(t.days.filter((d) => d.startsWith(ym)).map((d) => Number(d.slice(8))));
          const line = sumLine(days, t.text || '(без текста)', {
            done: t.done, files: (t.files || []).length,
            prefix: a ? `<i class="mood-dot" style="background:${a.color}"></i>` : '',
            onClick: () => openEvent(t, `#/month/${ym}?mode=tasks`),
          });
          list.appendChild(line);
        }
        bar.appendChild(list);
      }

      const btns = h(`<div class="selbar-btns"><button class="btn ghost" data-act="cancel">отменить</button><button class="btn" data-act="add">${picked.length ? 'новая задача' : 'добавить'}</button></div>`);
      btns.querySelector('[data-act=cancel]').onclick = () => { state.selection.clear(); draw(); };
      btns.querySelector('[data-act=add]').onclick = () => { location.hash = `#/add?days=${[...state.selection].sort().join(',')}&kind=task&back=${encodeURIComponent(`#/month/${ym}?mode=tasks`)}`; };
      bar.appendChild(btns);
      document.body.appendChild(bar);
    }
  }

  function onCell(day) {
    if (state.mode === 'tasks') {
      if (state.selection.has(day)) state.selection.delete(day); else state.selection.add(day);
      draw();
      return;
    }
    state.day = day;
    location.hash = `#/day/${day}`;
  }

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
    if (!list.length) box.appendChild(h(`<p class="p">в этом месяце пока нет занятий от трёх часов подряд</p>`));
    page.appendChild(box);
    drawInfographic();
  }

  function drawInfographic() {
    const bar = h('<div class="infobar"></div>');
    bar.appendChild(filterButton(() => draw()));
    bar.appendChild(h(`<span class="muted" style="font-size:1.5rem">${state.sort === 'weight' ? 'по весу' : 'по времени'}${state.hiddenKinds.size ? ` · скрыто: ${state.hiddenKinds.size}` : ''}</span>`));
    page.appendChild(bar);
    // собираем все отметки месяца
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
      if (it.kind === 'activity') dots.appendChild(h(`<i style="background:${it.color}"></i>`));
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
      const diff = Math.round(k.kcal - kcalNorm());
      const line = h(`<button class="food-line"><span class="k">${g.dom}</span><span><span class="kcal"><b>${k.kcal}</b> ккал <small>${diff >= 0 ? '+' : ''}${diff} к норме</small></span> <span class="macro">Б ${k.protein} · Ж ${k.fat} · У ${k.carbs}</span></span></button>`);
      line.onclick = () => { const e = perDay.get(g.date).find((x) => x.kind === 'food'); if (e) openEvent(e); };
      box.appendChild(line);
    }
    if (!any) box.appendChild(h('<p class="p">записей о еде в этом месяце нет</p>'));
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
        try { await put(`/api/events/${t.id}`, { done: !t.done }); invalidateEvents(); t.done = !t.done; for (const [, list] of perDay) { const x = list.find((y) => y.id === t.id); if (x) x.done = t.done; } draw(); }
        catch (e) { toast(e.message); }
      };
      line.querySelector('.k').onclick = () => openEvent(t);
      box.appendChild(line);
    }
    if (!tasks.length) box.appendChild(h('<p class="p">задач на этот месяц нет — выделите дни и нажмите «добавить»</p>'));
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
  return () => { document.querySelectorAll('.selbar').forEach((b) => b.remove()); };
}

function hasRun(hours, n) {
  const a = [...hours].sort((x, y) => x - y);
  let run = 1;
  for (let i = 1; i < a.length; i++) { run = a[i] === a[i - 1] + 1 ? run + 1 : 1; if (run >= n) return true; }
  return false;
}
