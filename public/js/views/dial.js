// Циферблат дня по макету «выбор часов»: широкое кольцо из 24 часов (ноль вверху), внутри риски и подписи часов.
// Короткое нажатие выбирает целый час (ближайшую часовую ячейку); шаг 15 минут (96 сегментов) включается,
// только если нажать и повести пальцем. Компонент рисует кольцо и принимает жесты;
// состоянием выбора (начало, конец, форма внизу) управляет представление дня.
import { quarterOwners, activity, isSleepEvent, darken, dotClock, spanLabel } from '../state.js';

const NS = 'http://www.w3.org/2000/svg';
// координаты макета: центр в нуле, внешний радиус 283.85, внутренний 187.7
const R_OUT = 283.85; const R_IN = 187.7;
const SEG = 3.75; // градусов на 15 минут
const VB = 292;

const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
const f2 = (n) => Math.round(n * 100) / 100;
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

// Метка выбора для шапки: «6.45» пока выбираем начало, «6.45-7.15» — диапазон
export function selLabel(sel) {
  if (!sel || sel.phase === 'none') return '';
  if (sel.phase === 'start' || sel.phase === 'picking-start') return dotClock(sel.a * 15);
  const lo = Math.min(sel.a, sel.b); const hi = Math.max(sel.a, sel.b);
  return spanLabel(lo * 15, (hi + 1) * 15);
}
// Диапазон выбора в минутах [начало, конец] или null
export function selSpan(sel) {
  if (!sel || sel.phase === 'none') return null;
  if (sel.phase === 'start' || sel.phase === 'picking-start') return [sel.a * 15, (sel.a + (sel.n || 1)) * 15];
  const lo = Math.min(sel.a, sel.b); const hi = Math.max(sel.a, sel.b);
  return [lo * 15, (hi + 1) * 15];
}

// opts: { events, sel, nowMin, marks:[{hour,color}], onPreview(sel), onCommit(kind, seg), onOutside() }
export function createDial(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'dial-wrap';
  const svg = el('svg', { viewBox: `${-VB} ${-VB} ${VB * 2} ${VB * 2}`, class: 'dial', role: 'img', 'aria-label': 'циферблат дня' });
  wrap.appendChild(svg);

  const defs = el('defs', {}, svg);
  // внутренняя тень основы кольца, как в макете
  const flt = el('filter', { id: 'dialShadow', x: -VB, y: -VB, width: VB * 2, height: VB * 2, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, defs);
  el('feFlood', { 'flood-opacity': 0, result: 'bg' }, flt);
  el('feBlend', { in: 'SourceGraphic', in2: 'bg', result: 'shape' }, flt);
  el('feColorMatrix', { in: 'SourceAlpha', type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0', result: 'hard' }, flt);
  el('feGaussianBlur', { stdDeviation: 12 }, flt);
  el('feComposite', { in2: 'hard', operator: 'arithmetic', k2: -1, k3: 1 }, flt);
  el('feColorMatrix', { type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0' }, flt);
  el('feBlend', { in2: 'shape' }, flt);

  // основа кольца: затемнение 40% с внутренней тенью
  const base = el('path', {
    d: `M${R_OUT} 0A${R_OUT} ${R_OUT} 0 1 1 ${-R_OUT} 0A${R_OUT} ${R_OUT} 0 1 1 ${R_OUT} 0ZM${R_IN} 0A${R_IN} ${R_IN} 0 1 0 ${-R_IN} 0A${R_IN} ${R_IN} 0 1 0 ${R_IN} 0Z`,
    fill: '#000', 'fill-opacity': .4, 'fill-rule': 'evenodd', filter: 'url(#dialShadow)',
  }, svg);
  base.setAttribute('class', 'dial-base');

  // градиенты занятий идут по диагонали всего кольца: цвет снизу слева, темнее сверху справа
  const grads = new Map();
  const gradFor = (hex) => {
    if (grads.has(hex)) return grads.get(hex);
    const id = `dg${grads.size}`;
    const g = el('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: -R_OUT, y1: R_OUT, x2: R_OUT, y2: -R_OUT }, defs);
    el('stop', { 'stop-color': hex }, g);
    el('stop', { offset: 1, 'stop-color': darken(hex) }, g);
    grads.set(hex, `url(#${id})`);
    return grads.get(hex);
  };

  // занятия: подряд идущие четверти одной записи сливаются в дугу
  const arcs = el('g', { class: 'dial-arcs' }, svg);
  const owners = quarterOwners(opts.events);
  for (let q = 0; q < 96;) {
    const o = owners[q];
    if (!o) { q++; continue; }
    let j = q; while (j + 1 < 96 && owners[j + 1] === o) j++;
    const a = o.activity_id ? activity(o.activity_id) : null;
    const sleep = isSleepEvent(o);
    const d = sector(q * SEG, (j + 1) * SEG);
    if (sleep) el('path', { d, fill: '#272727', 'fill-opacity': .5, stroke: '#1B296B', 'stroke-width': 4, 'stroke-linejoin': 'round' }, arcs);
    else {
      const color = a ? a.color : '#686868';
      const p = el('path', { d, fill: gradFor(color), stroke: '#1B296B', 'stroke-width': 4, 'stroke-linejoin': 'round' }, arcs);
      if (o.planned) p.setAttribute('fill-opacity', .45);
    }
    q = j + 1;
  }

  // риски внутри кольца: длинные — часы, короткие — четверти; подписи чётных часов
  const ticks = el('g', { class: 'dial-ticks', 'stroke-linecap': 'butt' }, svg);
  for (let q = 0; q < 96; q++) {
    const hourTick = q % 4 === 0;
    const [x0, y0] = pt(180.3, q * SEG); const [x1, y1] = pt(hourTick ? 169.2 : 174.7, q * SEG);
    el('line', { x1: f2(x0), y1: f2(y0), x2: f2(x1), y2: f2(y1), stroke: hourTick ? '#777EA8' : '#4F588E', 'stroke-width': 2 }, ticks);
  }
  for (let hr = 0; hr < 24; hr += 2) {
    const major = hr % 6 === 0;
    const [x, y] = pt(148, hr * 15);
    const t = el('text', { x: f2(x), y: f2(y + (major ? 8.5 : 5.5)), 'text-anchor': 'middle', 'font-size': major ? 25 : 15.5, fill: major ? '#DEDEDE' : '#919191' }, svg);
    t.textContent = hr;
  }
  // отметки наложений (еда, мысли, счётчик, задачи) — точки на кольце
  for (const m of opts.marks || []) {
    const [x, y] = pt(R_OUT - 12, m.hour * 15 + 1.5);
    el('circle', { cx: f2(x), cy: f2(y), r: 4.5, fill: m.color, stroke: '#000', 'stroke-opacity': .5, 'stroke-width': 1 }, svg);
  }
  // текущее время
  if (opts.nowMin != null) {
    const [x, y] = pt(R_IN - 14, opts.nowMin * .25);
    el('circle', { cx: f2(x), cy: f2(y), r: 5, fill: '#81FF96' }, svg);
  }

  // белая рамка выбора
  const frame = el('g', { class: 'dial-frame' }, svg);
  function paintFrame(sel) {
    frame.replaceChildren();
    if (!sel || sel.phase === 'none') return;
    let lo; let hi;
    if (sel.phase === 'start' || sel.phase === 'picking-start') { lo = sel.a; hi = sel.a + (sel.n || 1) - 1; } else { lo = Math.min(sel.a, sel.b); hi = Math.max(sel.a, sel.b); }
    el('path', { d: sector(lo * SEG, (hi + 1) * SEG), fill: 'none', stroke: '#fff', 'stroke-width': 6, 'stroke-linejoin': 'miter' }, frame);
  }
  paintFrame(opts.sel);

  // ---- жесты
  const geom = (e) => {
    const r = svg.getBoundingClientRect();
    const k = r.width / (VB * 2);
    const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI; if (deg < 0) deg += 360;
    return { dist: Math.hypot(dx, dy) / k, seg: Math.min(95, Math.floor(deg / SEG)) };
  };
  let gesture = null; // 'start' | 'end'
  let lastKey = '';
  let down = null;    // { x, y } точка нажатия
  let fine = false;   // true — шаг 15 минут (после движения пальцем)
  let curSeg = 0;
  const MOVE_PX = 8;  // сдвиг, после которого нажатие считается «ведением»
  svg.style.touchAction = 'none';
  // выбор по текущему жесту: целый час (4 четверти) или одна четверть
  function compute() {
    const n = fine ? 1 : 4;
    const s = fine ? curSeg : Math.floor(curSeg / 4) * 4;
    if (gesture === 'start') return { phase: 'picking-start', a: s, n };
    const base = opts.sel; const bn = base.n || 1;
    return { phase: 'picking-end', a: Math.min(base.a, s), b: Math.max(base.a + bn - 1, s + n - 1) };
  }
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    const g = geom(e);
    // кольцо; всё остальное — «мимо»
    if (g.dist < R_IN - 4 || g.dist > R_OUT + 6) { opts.onOutside?.(); return; }
    gesture = opts.sel && opts.sel.phase === 'start' ? 'end' : 'start';
    down = { x: e.clientX, y: e.clientY }; fine = false; curSeg = g.seg; lastKey = '';
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    apply();
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    if (!fine && Math.hypot(e.clientX - down.x, e.clientY - down.y) > MOVE_PX) fine = true;
    const g = geom(e);
    if (g.dist < 40) return; // у самого центра угол нестабилен
    curSeg = g.seg;
    apply();
  });
  function apply() {
    const tmp = compute();
    const key = JSON.stringify(tmp);
    if (key === lastKey) return;
    lastKey = key;
    paintFrame(tmp);
    opts.onPreview?.(tmp);
  }
  const end = (e) => {
    if (!gesture) return;
    const kind = gesture;
    if (e.type === 'pointercancel') { gesture = null; lastKey = ''; paintFrame(opts.sel); opts.onPreview?.(opts.sel); return; }
    const t = compute(); gesture = null; lastKey = '';
    opts.onCommit?.(kind, kind === 'start' ? { phase: 'start', a: t.a, n: t.n } : { phase: 'range', a: t.a, b: t.b });
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  return { el: wrap };
}
