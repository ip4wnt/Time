// Экран «год»: 12 месяцев, в каждом строка = день (24 часа от 0 до 23). Масштаб: щипок на телефоне, колесо мыши на ПК.
import { I } from '../icons.js';
import {
  state, todayStr, loadYear, loadDates, eventsOfDay, hourMap, isSleepEvent, activity, tag, counter,
  MONTHS_FULL, MONTHS_GEN, daysInMonth, esc, grad, hoursLabel, MOOD_COLOR,
} from '../state.js';
import { h } from '../ui.js';
import { calHeader, addBlock, selHeader, sumLine, hourChart } from './common.js';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export async function renderYear(yearStr, query = {}) {
  let year = Number(yearStr);
  if (!(year >= 1970 && year <= 2200)) year = Number(todayStr().slice(0, 4));
  state.day = state.day && state.day.startsWith(String(year)) ? state.day : (todayStr().startsWith(String(year)) ? todayStr() : `${year}-01-01`);
  state.month = state.day.slice(0, 7);
  const app = document.getElementById('app');
  document.body.classList.add('bg-year');

  const hdrHost = h('<div></div>');
  app.appendChild(hdrHost);
  hdrHost.appendChild(calHeader({
    swapIcon: 'year',
    swapTo: () => `#/month/${state.month && state.month.startsWith(String(year)) ? state.month : `${year}-01`}`,
    title: String(year),
    onTitle: () => yearPicker(year, (y) => { location.hash = `#/year/${y}`; }),
  }));
  const page = h('<div class="page year"></div>');
  app.appendChild(page);

  const [events] = await Promise.all([loadYear(year), loadDates().catch(() => null)]);
  const byDay = new Map();
  for (const e of events) {
    if (e.kind === 'task') continue; // задачи без часа в годовой сетке не видны
    if (!e.day || !e.day.startsWith(String(year))) continue;
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const today = todayStr();

  // ---------- сетка ----------
  const view = h('<div class="year-view"></div>');
  const canvas = h('<div class="year-canvas"></div>');
  view.appendChild(canvas);
  // на десктопе: слева год (80%), справа заметки к выбранному часу (20%)
  const cols = h('<div class="year-cols"></div>');
  const aside = h('<aside class="year-aside"><p class="ys-hint">нажмите на час, чтобы увидеть записи или добавить новую</p></aside>');
  cols.append(view, aside);
  page.appendChild(cols);
  const isDesk = () => window.matchMedia('(min-width: 1100px)').matches;

  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    const block = h(`<section class="ymonth" data-ym="${ym}"><div class="ymonth-title">${MONTHS_FULL[m - 1][0].toUpperCase()}${MONTHS_FULL[m - 1].slice(1)}</div></section>`);
    const g = h('<div class="ymonth-grid"></div>');
    const n = daysInMonth(ym);
    const counts = new Map(); // id занятия или 'empty' → число часов
    const bump = (k) => counts.set(k, (counts.get(k) || 0) + 1);
    for (let d = 1; d <= n; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      const evs = (byDay.get(date) || []);
      const hm = evs.length ? hourMap(evs) : null;
      for (let hr = 0; hr < 24; hr++) {
        const cell = document.createElement('button');
        cell.className = 'yc';
        cell.dataset.date = date; cell.dataset.hour = hr;
        if (date === today && hr === new Date().getHours()) cell.classList.add('now');
        let key = 'empty';
        if (hm) {
          const slot = hm[hr];
          const act = slot.all.find((e) => e.kind === 'activity');
          if (act && isSleepEvent(act)) { cell.classList.add('sleep'); key = act.activity_id; }
          else if (act) { const a = activity(act.activity_id); if (a) { cell.style.background = a.color; key = a.id; } }
        }
        bump(key);
        g.appendChild(cell);
        // метка дня в начале строки
      }
    }
    block.appendChild(g);
    block.appendChild(hourChart(counts, n * 24));
    canvas.appendChild(block);
  }

  // ---------- масштаб ----------
  let zoom = MIN_ZOOM;
  function setZoom(next, cx, cy) {
    if (isDesk()) return; // на ПК масштаба нет
    next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (Math.abs(next - zoom) < 0.001) return;
    // точка под пальцем/курсором остаётся на месте
    const rect = view.getBoundingClientRect();
    const px = (cx ?? rect.left + rect.width / 2) - rect.left;
    const py = (cy ?? rect.top + rect.height / 2) - rect.top;
    const k = next / zoom;
    const sx = (view.scrollLeft + px) * k - px;
    const sy = (view.scrollTop + py) * k - py;
    zoom = next;
    canvas.style.width = `${zoom * 100}%`;
    view.classList.toggle('zoomed', zoom > 1.01);
    view.scrollLeft = sx; view.scrollTop = sy;
  }
  // колесо мыши (трекпад с зажатым ctrl приходит так же)
  view.addEventListener('wheel', (e) => {
    if (isDesk() || e.shiftKey) return; // на ПК масштаба нет; shift + колесо — обычная прокрутка
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    setZoom(zoom * Math.exp(-dy * 0.0025), e.clientX, e.clientY);
  }, { passive: false });

  // щипок двумя пальцами
  const pts = new Map();
  let pinch = null; let pinched = false;
  view.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { pinch = pinchState(); pinched = true; }
  });
  view.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const cur = pinchState();
      setZoom(pinch.zoom * (cur.dist / pinch.dist), cur.cx, cur.cy);
      e.preventDefault();
    }
  });
  const endPtr = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) setTimeout(() => { pinched = false; }, 250); // щипок не должен считаться нажатием на час
  };
  view.addEventListener('pointerup', endPtr);
  view.addEventListener('pointercancel', endPtr);
  function pinchState() {
    const [a, b] = [...pts.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom };
  }

  // протягивание мышью для перемещения при увеличении
  let drag = null; let dragged = false;
  view.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isDesk()) return;
    drag = { x: e.clientX, y: e.clientY, sl: view.scrollLeft, st: view.scrollTop }; dragged = false;
  });
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', onDragEnd);
  function onDrag(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    view.scrollLeft = drag.sl - dx; view.scrollTop = drag.st - dy;
  }
  function onDragEnd() { drag = null; setTimeout(() => { dragged = false; }, 0); }

  // ---------- нажатие на час ----------
  view.addEventListener('click', (e) => {
    const c = e.target.closest('.yc');
    if (!c || pinched || dragged) return;
    openHour(c.dataset.date, Number(c.dataset.hour), c);
  });

  let sheet = null;
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } view.querySelectorAll('.yc.selected').forEach((x) => x.classList.remove('selected')); }

  function labelFor(e) {
    const t = (e.text || '').trim();
    if (e.kind === 'activity') { const a = activity(e.activity_id); const tg = e.tag_id ? tag(e.tag_id) : null; return t || [a?.name, tg?.name].filter(Boolean).join(' · ') || 'занятие'; }
    if (e.kind === 'counter') { const c = counter(e.counter_id); return `${c ? c.name : 'счётчик'}: ${e.counter_value}${c && c.unit ? ` ${c.unit}` : ''}`; }
    if (e.kind === 'food') return t + (e.kcal != null ? `${t ? ' — ' : ''}${Math.round(e.kcal)} ккал` : '');
    return t;
  }
  function prefixFor(e) {
    if (e.kind === 'activity') { const a = activity(e.activity_id); return a ? `<i class="mood-dot" style="background:${a.color}"></i>` : ''; }
    if (e.kind === 'thought') return `<i class="mood-dot" style="background:${MOOD_COLOR[e.mood || 'neutral']}"></i>`;
    return '';
  }

  function openHour(date, hr, cellEl) {
    closeSheet();
    cellEl.classList.add('selected');
    const [, mm, dd] = date.split('-').map(Number);
    const back = encodeURIComponent(`#/year/${year}`);
    const list = (byDay.get(date) || []).filter((e) => (e.hours || []).includes(hr)).sort((a, b) => (a.position - b.position) || (a.id - b.id));
    sheet = h(`<div class="year-sheet"><div class="ys-head"><span>${dd} ${MONTHS_GEN[mm - 1]}, ${String(hr).padStart(2, '0')}:00</span><button class="ys-close" aria-label="закрыть">${I.close}</button></div><div class="ys-body"></div></div>`);
    sheet.querySelector('.ys-close').onclick = closeSheet;
    const body = sheet.querySelector('.ys-body');
    if (list.length) {
      const box = h('<div class="summary"></div>');
      for (const e of list) {
        const text = labelFor(e) || '(без текста)';
        box.appendChild(sumLine(hoursLabel(e.hours), text, {
          files: (e.files || []).length, prefix: prefixFor(e),
          onClick: () => { location.hash = `#/add?day=${e.day}&hours=${(e.hours || []).join(',')}&edit=${e.id}&back=${back}`; },
        }));
      }
      body.appendChild(box);
    } else {
      body.appendChild(h('<p class="p">в этот час записей нет</p>'));
    }
    body.appendChild(addBlock((kind) => {
      location.hash = kind === 'task'
        ? `#/add?days=${date}&hours=${hr}&kind=task&back=${back}`
        : `#/add?day=${date}&hours=${hr}&kind=${kind}&back=${back}`;
    }));
    (isDesk() ? aside : document.body).appendChild(sheet);
  }

  // открываем на нужном месяце
  const focusYm = state.month && state.month.startsWith(String(year)) ? state.month : `${year}-01`;
  const target = canvas.querySelector(`[data-ym="${focusYm}"]`);
  if (target && !isDesk()) view.scrollTop = target.offsetTop - 4;
  return () => {
    closeSheet();
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', onDragEnd);
    document.body.classList.remove('bg-year');
  };
}

// Выпадающий выбор года
function yearPicker(year, onPick) {
  const pop = h('<div class="popover picker"></div>');
  let base = year - 4;
  function draw() {
    pop.innerHTML = '';
    const head = h(`<div class="pick-head"><button class="pick-nav" data-act="p">${I.back}</button><span>${base}–${base + 8}</span><button class="pick-nav" data-act="n">${I.fwd}</button></div>`);
    head.querySelector('[data-act=p]').onclick = (e) => { e.stopPropagation(); base -= 9; draw(); };
    head.querySelector('[data-act=n]').onclick = (e) => { e.stopPropagation(); base += 9; draw(); };
    pop.appendChild(head);
    const g = h('<div class="pick-months"></div>');
    for (let y = base; y < base + 9; y++) {
      const b = h(`<button class="${y === year ? 'on' : ''}">${y}</button>`);
      b.onclick = () => { pop.remove(); onPick(y); };
      g.appendChild(b);
    }
    pop.appendChild(g);
  }
  draw();
  return pop;
}
