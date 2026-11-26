// Циферблат дня: 24 часа по кругу, ноль часов вверху, шаг выбора 15 минут (96 сегментов).
// Длинные риски — часы, короткие — четверти. Компонент рисует кольцо и принимает жесты;
// состоянием выбора (начало, конец, форма внизу) управляет представление дня.
import { quarterOwners, activity, isSleepEvent, clock, spanLabel, fmtHours } from '../state.js';

const NS = 'http://www.w3.org/2000/svg';
const CX = 50; const CY = 50;
const R_IN = 30; const R_OUT = 44;       // кольцо с занятиями
const SEG = 3.75;                         // градусов на 15 минут

const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
const f2 = (n) => Math.round(n * 100) / 100;
// сектор кольца от угла d0 до d1 (по часовой, от верха)
function sector(d0, d1, ri = R_IN, ro = R_OUT) {
  const [x0, y0] = pt(ro, d0); const [x1, y1] = pt(ro, d1);
  const [x2, y2] = pt(ri, d1); const [x3, y3] = pt(ri, d0);
  const large = (d1 - d0) > 180 ? 1 : 0;
  return `M${f2(x0)} ${f2(y0)} A${ro} ${ro} 0 ${large} 1 ${f2(x1)} ${f2(y1)} L${f2(x2)} ${f2(y2)} A${ri} ${ri} 0 ${large} 0 ${f2(x3)} ${f2(y3)} Z`;
}
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

// Метка выбора для шапки: «6:45» пока выбираем начало, «6:45–7:15» — диапазон
export function selLabel(sel) {
  if (!sel || sel.phase === 'none') return '';
  if (sel.phase === 'start' || sel.phase === 'picking-start') return clock(sel.a * 15);
  const lo = Math.min(sel.a, sel.b); const hi = Math.max(sel.a, sel.b);
  return spanLabel(lo * 15, (hi + 1) * 15);
}
// Диапазон выбора в минутах [начало, конец] или null
export function selSpan(sel) {
  if (!sel || sel.phase === 'none') return null;
  if (sel.phase === 'start' || sel.phase === 'picking-start') return [sel.a * 15, sel.a * 15 + 15];
  const lo = Math.min(sel.a, sel.b); const hi = Math.max(sel.a, sel.b);
  return [lo * 15, (hi + 1) * 15];
}

// opts: { events, sel, nowMin, marks:[{hour,color}], hasRecords, onPreview(sel), onCommit(kind, seg), onOutside() }
export function createDial(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'dial-wrap';
  const svg = el('svg', { viewBox: '0 0 100 100', class: 'dial', role: 'img', 'aria-label': 'циферблат дня' });
  wrap.appendChild(svg);

  const defs = el('defs', {}, svg);
  const bg = el('radialGradient', { id: 'dialBg', cx: '50%', cy: '50%', r: '50%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#2b2b2b', 'stop-opacity': '.55' }, bg);
  el('stop', { offset: '70%', 'stop-color': '#151115', 'stop-opacity': '.9' }, bg);
  el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': '.95' }, bg);
  el('circle', { cx: CX, cy: CY, r: 49.2, fill: 'url(#dialBg)' }, svg);

  // фон кольца
  const track = el('g', { class: 'dial-track' }, svg);
  el('circle', { cx: CX, cy: CY, r: (R_IN + R_OUT) / 2, fill: 'none', stroke: '#1c181c', 'stroke-width': R_OUT - R_IN }, track);

  // занятия: подряд идущие четверти одной записи сливаются в дугу
  const arcs = el('g', { class: 'dial-arcs' }, svg);
  const owners = quarterOwners(opts.events);
  for (let q = 0; q < 96;) {
    const o = owners[q];
    if (!o) { q++; continue; }
    let j = q; while (j + 1 < 96 && owners[j + 1] === o) j++;
    const a = o.activity_id ? activity(o.activity_id) : null;
    const sleep = isSleepEvent(o);
    const color = sleep ? '#3a363a' : (a ? a.color : '#686868');
    const p = el('path', { d: sector(q * SEG + .12, (j + 1) * SEG - .12), fill: color, 'fill-opacity': o.planned ? .4 : 1 }, arcs);
    if (o.planned) { p.setAttribute('stroke', color); p.setAttribute('stroke-width', '.35'); p.setAttribute('stroke-dasharray', '1.2 .8'); }
    q = j + 1;
  }

  // риски: длинные — часы, короткие — четверти (снаружи кольца)
  const ticks = el('g', { class: 'dial-ticks', stroke: '#fff', 'stroke-linecap': 'round' }, svg);
  for (let q = 0; q < 96; q++) {
    const hourTick = q % 4 === 0;
    const [x0, y0] = pt(R_OUT + .9, q * SEG); const [x1, y1] = pt(R_OUT + (hourTick ? 4.2 : 2.2), q * SEG);
    el('line', { x1: f2(x0), y1: f2(y0), x2: f2(x1), y2: f2(y1), 'stroke-width': hourTick ? .55 : .3, 'stroke-opacity': hourTick ? .85 : .45 }, ticks);
  }
  // подписи часов внутри кольца
  for (let hr = 0; hr < 24; hr++) {
    const [x, y] = pt(R_IN - 3.6, hr * 15 + 7.5 - 7.5);
    const t = el('text', { x: f2(x), y: f2(y + 1.1), 'text-anchor': 'middle', 'font-size': hr % 3 === 0 ? 3.4 : 2.6, fill: '#fff', 'fill-opacity': hr % 3 === 0 ? .75 : .35 }, svg);
    t.textContent = hr;
  }
  // отметки наложений (еда, мысли, счётчик, задачи): точки под подписью часа
  for (const m of opts.marks || []) {
    const [x, y] = pt(R_IN - 7.4, m.hour * 15);
    el('circle', { cx: f2(x), cy: f2(y), r: .9, fill: m.color }, svg);
  }
  // текущее время
  if (opts.nowMin != null) {
    const [x, y] = pt(R_OUT + 6.6, opts.nowMin * .25);
    el('circle', { cx: f2(x), cy: f2(y), r: 1.1, fill: '#81FF96' }, svg);
  }

  // рамка выбора и подпись в центре
  const frame = el('g', { class: 'dial-frame' }, svg);
  const center = el('g', { class: 'dial-center' }, svg);
  const cMain = el('text', { x: CX, y: CY + 1.8, 'text-anchor': 'middle', 'font-size': 7, fill: '#fff' }, center);
  const cSub = el('text', { x: CX, y: CY + 8, 'text-anchor': 'middle', 'font-size': 2.8, fill: '#fff', 'fill-opacity': .5 }, center);

  function paintCenter(sel) {
    if (sel && sel.phase !== 'none') { cMain.textContent = selLabel(sel); cSub.textContent = ''; return; }
    cMain.textContent = opts.hasRecords ? fmtHours(opts.filledHours || 0) : '';
    cSub.textContent = opts.hasRecords ? 'ч записано' : 'нажмите на кольцо';
  }
  function paintFrame(sel) {
    frame.replaceChildren();
    if (sel && sel.phase !== 'none') {
      if (sel.phase === 'start' || sel.phase === 'picking-start') {
        // белая отсечка начала диапазона: рамка вокруг четверти и длинная линия от центра кольца
        el('path', { d: sector(sel.a * SEG, (sel.a + 1) * SEG), fill: 'none', stroke: '#fff', 'stroke-width': .7, 'stroke-linejoin': 'round' }, frame);
        const [x0, y0] = pt(R_IN - 1.5, sel.a * SEG); const [x1, y1] = pt(R_OUT + 4.6, sel.a * SEG);
        el('line', { x1: f2(x0), y1: f2(y0), x2: f2(x1), y2: f2(y1), stroke: '#fff', 'stroke-width': .9, 'stroke-linecap': 'round' }, frame);
      } else {
        const lo = Math.min(sel.a, sel.b); const hi = Math.max(sel.a, sel.b);
        el('path', { d: sector(lo * SEG, (hi + 1) * SEG), fill: 'rgba(255,255,255,.12)', stroke: '#fff', 'stroke-width': .8, 'stroke-linejoin': 'round' }, frame);
      }
    }
    paintCenter(sel);
  }
  paintFrame(opts.sel);

  // ---- жесты
  const geom = (e) => {
    const r = svg.getBoundingClientRect();
    const k = r.width / 100;
    const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI; if (deg < 0) deg += 360;
    return { dist: Math.hypot(dx, dy) / k, seg: Math.min(95, Math.floor(deg / SEG)) };
  };
  let gesture = null; // 'start' | 'end'
  svg.style.touchAction = 'none';
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    const g = geom(e);
    // кольцо вместе с рисками; всё остальное — «мимо»
    if (g.dist < R_IN - 1 || g.dist > R_OUT + 5) { opts.onOutside?.(); return; }
    gesture = opts.sel && opts.sel.phase === 'start' ? 'end' : 'start';
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    apply(g.seg);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const g = geom(e);
    if (g.dist < 6) return; // у самого центра угол нестабилен
    if (g.seg !== lastSeg) apply(g.seg);
  });
  let lastSeg = -1;
  function apply(seg) {
    lastSeg = seg;
    const tmp = gesture === 'start' ? { phase: 'picking-start', a: seg } : { phase: 'picking-end', a: opts.sel.a, b: seg };
    paintFrame(tmp);
    opts.onPreview?.(tmp);
  }
  const end = (e) => {
    if (!gesture) return;
    const kind = gesture; gesture = null;
    const seg = lastSeg; lastSeg = -1;
    if (e.type === 'pointercancel') { paintFrame(opts.sel); opts.onPreview?.(opts.sel); return; }
    opts.onCommit?.(kind, seg);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  return { el: wrap };
}
