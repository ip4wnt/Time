// Экран «день»: сетка часов 6×4, крошки-навигация, фильтры-наложения, блочная сводка, инфографика.
import { I, KIND_ICON, MOOD_ICON } from '../icons.js';
import {
  state, dayLabel, dotDate, todayStr, ymOf, loadDay, loadDates, hourMap, foodHeat, dayKcal, topCounter,
  isImportant, isSleepEvent, activity, tag, counter, MOOD_COLOR, hoursLabel, hoursRange, kcalNorm, grad, plannedBg, activityLabel, invalidateEvents,
  dayViewMode, quarterOwners, spanHours, eventSegments, eventTimeLabel, dayHourCounts, fmtHours,
} from '../state.js';
import { createDial, selLabel, selSpan } from './dial.js';
import { h, toast } from '../ui.js';
import { put } from '../api.js';
import { renderAdd } from './add.js';
import {
  calHeader, dayPicker, filtersBar, activeFilters, cellRows, hourChart, periodNote, sumLine, sumSep, hiddenInSummary,
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
  // циферблат: состояние выбора. none → start (начало зафиксировано) → range (диапазон выбран)
  const dial = dayViewMode() === 'dial';
  let dsel = { phase: 'none' };
  // на десктопе слева часы с фильтрами, справа сводка дня
  let colL = null; let colR = null;

  let evs; let hm; let tasks; let taskHours;
  function indexDay(list) {
    evs = list; hm = hourMap(evs);
    tasks = evs.filter((e) => e.kind === 'task');
    // задачи могут быть привязаны к часу — собираем их по часам для наложений
    taskHours = Array.from({ length: 24 }, () => []);
    for (const t of tasks) for (const hr of t.hours || []) if (hr >= 0 && hr < 24) taskHours[hr].push(t);
  }
  const [dayList] = await Promise.all([loadDay(day), loadDates().catch(() => null)]);
  indexDay(dayList);
  // после удаления записи в форме: перечитываем день и перерисовываем, не выходя из выбора часов
  async function reloadDay() { indexDay(await loadDay(day)); draw(); }
  const isToday = day === todayStr();
  const nowHour = new Date().getHours();
  const tc = topCounter();
  const norm = kcalNorm();
  const imp = isImportant(day);

  // клавиатура: стрелки двигают выделение часа, Shift+стрелки растягивают диапазон
  let kbCursor = null; let kbAnchor = null;

  // встроенное добавление: при выборе часов внизу сразу открывается форма занятия, иконки сверху переключают вид
  let addKind = 'activity';
  const embedHost = h('<div class="add-host"></div>');
  let embedCleanup = null; let embedKey = ''; let mountToken = 0;
  function teardownEmbed() {
    mountToken++;
    if (typeof embedCleanup === 'function') embedCleanup();
    embedCleanup = null; embedKey = ''; embedHost.innerHTML = '';
  }
  async function mountEmbed(keepDraft) {
    const token = ++mountToken;
    const hrs = selectedHours().join(',');
    const sp = dial ? selSpan(dsel) : null;
    const q = addKind === 'task' ? { days: day, hours: hrs, kind: 'task' } : { day, hours: hrs, kind: addKind };
    if (sp && addKind !== 'task') q.span = sp.join('-');
    if (dial && dsel.phase === 'start' && addKind !== 'task') {
      q.start = '1'; // конец диапазона ещё не выбран
      // начало попало в уже созданное занятие: сначала правка этого занятия, а не создание нового
      if (quarterOwners(evs)[dsel.a]) q.existing = '1';
    }
    const fresh = h('<div></div>');
    const c = await renderAdd(q, {
      host: fresh,
      onDone: () => { teardownEmbed(); window.dispatchEvent(new HashChangeEvent('hashchange')); },
      onCancel: () => exitSel(),
      onChange: () => reloadDay(),
    });
    if (token !== mountToken) { if (typeof c === 'function') c(); return; }
    const draft = keepDraft && embedCleanup?.getDraft ? embedCleanup.getDraft() : null; // берем в момент замены, чтобы не потерять набранное
    if (typeof embedCleanup === 'function') embedCleanup();
    embedCleanup = c;
    if (draft) c.setDraft?.(draft);
    embedHost.replaceChildren(fresh);
  }
  function goAdd(kind) {
    const back = encodeURIComponent(`#/day/${day}`);
    const hrs = selectedHours().join(',');
    location.hash = kind === 'task'
      ? `#/add?days=${day}&hours=${hrs}&kind=task&back=${back}`
      : `#/add?day=${day}&hours=${hrs}&kind=${kind}&back=${back}`;
  }
  const ARROW_DIAL = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
  const ARROW = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (state.menuOpen || document.querySelector('.dlg-back')) return;
    if (embedCleanup?.isEngaged?.()) return; // клавиатура у формы справа
    if (!dial && e.key in ARROW) {
      e.preventDefault();
      if (kbCursor === null) {
        if (selMode && state.selection.size) { kbCursor = Math.min(...state.selection); kbAnchor = kbCursor; }
        else { kbCursor = isToday ? nowHour : 0; kbAnchor = kbCursor; selMode = true; state.selection = new Set([kbCursor]); draw(); return; } // первое нажатие только показывает квадрат
      }
      const next = kbCursor + ARROW[e.key];
      if (next < 0 || next > 23) return;
      kbCursor = next;
      if (!e.shiftKey) kbAnchor = next;
      const lo = Math.min(kbAnchor, kbCursor); const hi = Math.max(kbAnchor, kbCursor);
      state.selection = new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      selMode = true; draw();
    } else if (dial && e.key in ARROW_DIAL) {
      // циферблат: влево/вправо — на 15 минут, вверх/вниз — на час; Shift растягивает диапазон от точки старта
      e.preventDefault();
      if (kbCursor === null) {
        if (dsel.phase === 'start') { kbCursor = dsel.a; kbAnchor = dsel.a; }
        else if (dsel.phase === 'range') { kbCursor = Math.max(dsel.a, dsel.b); kbAnchor = Math.min(dsel.a, dsel.b); }
        else { kbCursor = (isToday ? nowHour : 0) * 4; kbAnchor = kbCursor; selMode = true; dsel = { phase: 'start', a: kbCursor }; draw(); return; } // первое нажатие только показывает начало
      }
      const next = Math.max(0, Math.min(95, kbCursor + ARROW_DIAL[e.key]));
      if (next === kbCursor) return;
      kbCursor = next;
      if (!e.shiftKey) kbAnchor = next;
      selMode = true;
      dsel = kbAnchor === kbCursor ? { phase: 'start', a: kbCursor } : { phase: 'range', a: kbAnchor, b: kbCursor };
      draw();
    } else if (e.key === 'Enter' && selMode && (dial ? dsel.phase !== 'none' : state.selection.size)) {
      e.preventDefault(); e.stopImmediatePropagation(); embedCleanup?.engage?.();
    } else if (e.key === 'Escape' && selMode) {
      e.preventDefault(); exitSel();
    }
  }
  window.addEventListener('keydown', onKey);

  function selectedHours() {
    if (dial) { const sp = selSpan(dsel); return sp ? spanHours(sp[0], sp[1]) : []; }
    return [...state.selection].sort((a, b) => a - b);
  }
  const selKey = () => `${addKind}|${selectedHours().join(',')}|${dial ? `${(selSpan(dsel) || []).join('-')}|${dsel.phase}` : ''}`;

  function exitSel() { selMode = false; kbCursor = null; kbAnchor = null; state.selection.clear(); dsel = { phase: 'none' }; draw(); }

  function drawHeader() {
    hdrHost.innerHTML = '';
    if (selMode) {
      hdrHost.appendChild(selHeader({
        mid: `<span class="sel-time">${dial ? selLabel(dsel) : hoursRange(selectedHours())}</span><span class="sep">/</span><span>${dotDate(day)}</span>`,
        onClose: exitSel,
      }));
      return;
    }
    hdrHost.appendChild(calHeader({
      swapIcon: 'clock',
      swapTo: () => `#/year/${day.slice(0, 4)}`,
      title: dayLabel(day),
      onTitle: () => dayPicker(day, (d) => { location.hash = `#/day/${d}`; }),
    }));
  }

  function draw() {
    document.body.classList.toggle('bg-hours', selMode);
    document.body.classList.toggle('dial-sel', dial && selMode);
    document.body.classList.toggle('bg-day', !selMode);
    drawHeader();
    page.innerHTML = '';
    const cols = h('<div class="cal-cols"></div>');
    colL = h('<div class="cal-l"></div>'); colR = h('<div class="cal-r"></div>');
    cols.append(colL, colR); page.appendChild(cols);
    const g = h('<div class="grid grid-day"></div>');
    const owners = quarterOwners(evs);
    for (let hr = 0; hr < 24; hr++) {
      const slot = hm[hr];
      const bottom = `<span class="cell-num">${hr}</span>${imp && hr === 0 ? `<span class="cell-star">${I.star}</span>` : ''}`;
      const { rows, html } = cellRows(overlays(slot, hr), bottom);
      const cell = h(`<button class="cell ${isToday && hr === nowHour ? 'today' : ''} ${state.selection.has(hr) ? 'selected' : ''}" style="--rows:${rows}" data-hour="${hr}">${html}</button>`);
      const qs = owners.slice(hr * 4, hr * 4 + 4);
      const act = slot.all.find((e) => e.kind === 'activity');
      if (qs.some((o) => o !== qs[0])) {
        // час занят частично или разными занятиями: закрашиваем по четвертям сверху вниз
        const col = (o) => { if (!o) return 'transparent'; if (isSleepEvent(o)) return '#2a262a'; const a = activity(o.activity_id); return a ? a.color : 'transparent'; };
        const stops = qs.map((o, i) => `${col(o)} ${i * 25}% ${(i + 1) * 25}%`).join(', ');
        cell.style.background = `linear-gradient(180deg, ${stops})`;
        cell.classList.add('colored', 'partial');
      } else if (act && isSleepEvent(act)) cell.classList.add('sleep');
      else if (act) { const a = activity(act.activity_id); if (a) { cell.style.background = act.planned ? plannedBg(a.color, 5) : grad(a.color); cell.classList.add('colored'); } }
      if (slot.extras.length) cell.classList.add('multi');
      // с клавиатуры (Enter/пробел) час переключается обычным нажатием; мышь и палец обрабатывает сетка целиком
      cell.onclick = (e) => {
        if (e.detail !== 0) return;
        if (!selMode) { selMode = true; state.selection = new Set([hr]); } else if (state.selection.has(hr)) state.selection.delete(hr); else state.selection.add(hr);
        if (!state.selection.size) selMode = false;
        draw();
      };
      g.appendChild(cell);
    }
    if (dial) colL.appendChild(buildDial());
    else { attachSweep(g); colL.appendChild(g); }
    if (selMode) {
      colR.appendChild(addBlock((kind) => {
        if (kind === addKind) return;
        addKind = kind; embedKey = selKey(); mountEmbed(false); draw();
      }, addKind));
      const key = selKey();
      if (key !== embedKey) { const same = embedKey.split('|')[0] === addKind && embedKey.split('|')[3] === key.split('|')[3]; embedKey = key; mountEmbed(same); }
      colR.appendChild(embedHost);
      return;
    }
    if (embedCleanup || embedKey) teardownEmbed();
    addKind = 'activity';
    colL.appendChild(filtersBar(() => draw()));

    drawActivities();
    for (const f of activeFilters()) {
      colR.appendChild(sumSep());
      if (f === 'food') drawFood();
      else if (f === 'counter') drawCounters();
      else if (f === 'task') drawTasks();
      else if (f === 'thought') drawThoughts();
    }
    drawChart();
    colR.appendChild(periodNote('day', day, 'чем запомнился день:'));
  }

  // наложения на ячейку часа
  // выделение протяжкой: нажал на час и повёл мышью/пальцем; первый час определяет действие —
  // невыделенный выделяет всё, по чему провели, выделенный снимает выделение с тех, по которым провели
  function attachSweep(g) {
    let sweeping = false; let erase = false; let last = -1; let moved = false;
    const hourAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const c = el && el.closest ? el.closest('.cell[data-hour]') : null;
      return c && g.contains(c) ? Number(c.dataset.hour) : -1;
    };
    // все часы между прошлой и текущей точкой: быстрый жест не должен пропускать клетки
    const apply = (hr) => {
      if (hr < 0 || hr === last) return;
      const from = last < 0 ? hr : last;
      const step = hr >= from ? 1 : -1;
      for (let i = from; i !== hr + step; i += step) {
        if (erase) state.selection.delete(i); else state.selection.add(i);
        const c = g.querySelector(`.cell[data-hour="${i}"]`);
        if (c) c.classList.toggle('selected', state.selection.has(i));
      }
      last = hr;
    };
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0) return;
      const hr = hourAt(e.clientX, e.clientY);
      if (hr < 0) return;
      sweeping = true; moved = false; last = -1;
      erase = selMode && state.selection.has(hr);
      if (!selMode) { selMode = true; state.selection = new Set(); }
      try { g.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      apply(hr);
      e.preventDefault();
    });
    g.addEventListener('pointermove', (e) => {
      if (!sweeping) return;
      const hr = hourAt(e.clientX, e.clientY);
      if (hr >= 0 && hr !== last) { moved = true; apply(hr); }
    });
    const end = () => {
      if (!sweeping) return;
      sweeping = false;
      if (!state.selection.size) selMode = false;
      kbCursor = null; kbAnchor = null;
      draw();
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  }

  // ---- циферблат
  function dialMarks() {
    const out = [];
    const colors = { food: '#73D383', counter: '#DEDEDE', thought: '#F2D96B', task: '#B8B8B8' };
    for (let hr = 0; hr < 24; hr++) {
      const o = overlays(hm[hr], hr);
      for (const f of activeFilters()) if (o[f]) out.push({ hour: hr, color: colors[f] || '#fff' });
    }
    // точки одного часа раздвигаем, чтобы не слипались
    const seen = {};
    return out.map((m) => { const n = seen[m.hour] || 0; seen[m.hour] = n + 1; return { ...m, hour: m.hour + n * 0.18 - 0.0 }; });
  }
  function buildDial() {
    const d = createDial({
      events: evs, sel: dsel, nowMin: isToday ? new Date().getHours() * 60 + new Date().getMinutes() : null,
      marks: dialMarks(),
      onPreview: (tmp) => { if (tmp.phase === 'none') { selMode = false; drawHeader(); return; } const t = hdrHost.querySelector('.sel-time'); if (t) t.textContent = selLabel(tmp); if (!selMode) { selMode = true; drawHeader(); const t2 = hdrHost.querySelector('.sel-time'); if (t2) t2.textContent = selLabel(tmp); } },
      onCommit: (kind, seg) => {
        selMode = true; kbCursor = null; kbAnchor = null;
        if (kind === 'start') dsel = { phase: 'start', a: seg };
        else dsel = { phase: 'range', a: dsel.a, b: seg };
        draw();
      },
      onOutside: () => { if (selMode) exitSel(); },
    });
    d.el.classList.toggle('sel', dsel.phase !== 'none');
    return d.el;
  }
  // нажатие в пустое место экрана (мимо кольца и элементов интерфейса) отменяет выбор
  if (dial) {
    page.addEventListener('pointerdown', (e) => {
      if (!selMode) return;
      const t = e.target;
      if (t === page || (t.classList && (t.classList.contains('cal-cols') || t.classList.contains('cal-l') || t.classList.contains('cal-r') || t.classList.contains('dial-wrap')))) exitSel();
    });
  }

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
    if (e.kind === 'activity') { return activityLabel(e); }
    if (e.kind === 'counter') { const c = counter(e.counter_id); return `${c ? c.name : 'счётчик'}: ${e.counter_value}${c && c.unit ? ` ${c.unit}` : ''}`; }
    if (e.kind === 'money') return `${e.money_amount != null ? Math.round(e.money_amount).toLocaleString('ru-RU') + ' ₽' : 'деньги'}${(e.text || '').trim() ? ` — ${(e.text || '').trim()}` : ''}`;
    if (e.kind === 'food') return (e.text || '').trim() + (e.kcal != null ? ` — ${Math.round(e.kcal)} ккал` : '');
    return (e.text || '').trim();
  }
  function prefixFor(e) {
    if (e.kind === 'activity') { const a = activity(e.activity_id); return a ? `<i class="mood-dot" style="background:${a.color}"></i>` : ''; }
    if (e.kind === 'thought') return `<i class="mood-dot" style="background:${MOOD_COLOR[e.mood || 'neutral']}"></i>`;
    return `<span class="ico" style="display:inline-block;width:1.6rem;height:1.6rem;vertical-align:middle;margin-right:.6rem">${I[KIND_ICON[e.kind]]}</span>`;
  }

  // Комментарии к часам: час или диапазон, цвет занятия и текст. Занятия без комментария здесь не нужны: они видны в квадратиках.
  function drawActivities() {
    const box = h('<div class="summary"></div>');
    const list = evs.filter((e) => e.kind === 'activity' && (e.text || '').trim())
      .sort((a, b) => (eventSegments(a)[0][0] - eventSegments(b)[0][0]) || (a.position - b.position));
    for (const e of list) box.appendChild(sumLine(eventTimeLabel(e), (e.text || '').trim(), { files: (e.files || []).length, prefix: prefixFor(e), onClick: () => openEvent(e) }));
    if (!list.length) box.appendChild(h('<p class="p">комментариев к часам пока нет</p>'));
    colR.appendChild(box);
  }

  // диаграмма дня: сколько часов на какое занятие
  function drawChart() {
    colR.appendChild(hourChart(dayHourCounts(evs), 24, true));
  }

  function drawFood() {
    const k = dayKcal(evs);
    if (k) {
      const diff = Math.round(k.kcal - norm);
      colR.appendChild(h(`<div class="sum-head"><span><b>${k.kcal}</b> ккал</span><span class="muted">${diff >= 0 ? '+' : ''}${diff} к норме</span></div><div class="progress"><i style="width:${Math.min(100, Math.round(k.kcal / norm * 100))}%;background:${foodHeat(k.kcal)}"></i></div><p class="p">белки ${k.protein} · жиры ${k.fat} · углеводы ${k.carbs}</p>`));
    }
    const box = h('<div class="summary"></div>');
    const list = evs.filter((e) => e.kind === 'food').sort((a, b) => eventSegments(a)[0][0] - eventSegments(b)[0][0]);
    for (const e of list) box.appendChild(sumLine(eventTimeLabel(e), labelFor(e), { files: (e.files || []).length, onClick: () => openEvent(e) }));
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
    const list = evs.filter((e) => e.kind === 'thought').sort((a, b) => eventSegments(a)[0][0] - eventSegments(b)[0][0]);
    for (const e of list) box.appendChild(sumLine(eventTimeLabel(e), e.text || '', { prefix: prefixFor(e), onClick: () => openEvent(e) }));
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
  return () => { window.removeEventListener('keydown', onKey); teardownEmbed(); document.querySelectorAll('.selbar').forEach((b) => b.remove()); document.body.classList.remove('bg-day', 'bg-hours', 'dial-sel'); };
}
