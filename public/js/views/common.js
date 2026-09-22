// Общие блоки календарных экранов: шапка-крошки, фильтры, выбор даты, строки саммари.
import { I, KIND_ICON } from '../icons.js';
import { state, savePrefs, esc, KINDS, MONTHS_FULL, monthGrid, todayStr, ymOf, addMonths, WEEKDAYS } from '../state.js';
import { h } from '../ui.js';

// Порядок кнопок-фильтров под сеткой — как в макете.
export const FILTERS = [
  { id: 'task', icon: 'list', title: 'задачи' },
  { id: 'money', icon: 'ruble', title: 'деньги', disabled: true },
  { id: 'food', icon: 'apple', title: 'еда' },
  { id: 'counter', icon: 'timer', title: 'счетчики' },
  { id: 'thought', icon: 'cloud', title: 'мысли' },
];
// Порядок строк-наложений внутри ячейки дня/часа.
export const CELL_ORDER = ['food', 'counter', 'task', 'thought'];
export const FILTER_KIND = { food: 'food', counter: 'counter', task: 'task', thought: 'thought' };

export function activeFilters() { return CELL_ORDER.filter((f) => state.filters.has(f)); }

// Виды записей в блоке «добавить» — порядок как в макете: занятие, задача, деньги, еда, счетчик, мысли.
export const ADD_KINDS = [
  { id: 'activity', icon: 'dots', title: 'занятие' },
  { id: 'task', icon: 'list', title: 'задача' },
  { id: 'money', icon: 'ruble', title: 'деньги', disabled: true },
  { id: 'food', icon: 'apple', title: 'еда' },
  { id: 'counter', icon: 'timer', title: 'счетчик' },
  { id: 'thought', icon: 'cloud', title: 'мысли' },
];

// Заголовок блока: тонкие линии по бокам, по центру название (макеты «добавить …»).
export function secTitle(text, { collapsed = null, onToggle = null } = {}) {
  const el = h(`<div class="sec-title"><i class="ln"></i><span>${esc(text)}</span>${collapsed === null ? '' : `<button class="chev ${collapsed ? 'up' : ''}" aria-label="свернуть">${I.chevDown}</button>`}<i class="ln"></i></div>`);
  const b = el.querySelector('.chev');
  if (b && onToggle) b.onclick = onToggle;
  return el;
}

// Блок «Добавить» под сеткой в режиме выбора часов
export function addBlock(onPick) {
  const el = h(`<div class="addblock"></div>`);
  el.appendChild(secTitle('Добавить'));
  const row = h(`<div class="icons">${ADD_KINDS.map((k) => `<button class="${k.disabled ? 'off' : ''}" data-kind="${k.id}" title="${k.title}" ${k.disabled ? 'disabled' : ''}>${I[k.icon]}</button>`).join('')}</div>`);
  row.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (!b || b.disabled) return; onPick(b.dataset.kind); });
  el.appendChild(row);
  return el;
}

// Шапка режима выбора/добавления: крестик слева, по центру время и дата, справа поиск
export function selHeader({ mid, onClose, search = false }) {
  const el = h(`<header class="hdr sel">
    <button class="hdr-btn" data-act="close" aria-label="выйти">${I.close}</button>
    <div class="mid"></div>
    ${search ? `<button class="hdr-btn" data-act="search" aria-label="поиск">${I.search}</button>` : '<span class="hdr-btn"></span>'}
  </header>`);
  el.querySelector('[data-act=close]').onclick = onClose;
  const s = el.querySelector('[data-act=search]');
  if (s) s.onclick = () => { location.hash = '#/search'; };
  const midEl = el.querySelector('.mid');
  if (typeof mid === 'string') midEl.innerHTML = mid; else midEl.appendChild(mid);
  return el;
}

export function filtersBar(onChange) {
  const el = h(`<div class="filters">${FILTERS.map((f) => `
    <button class="fbtn ${state.filters.has(f.id) ? 'on' : ''} ${f.disabled ? 'off' : ''}" data-filter="${f.id}" title="${f.title}" ${f.disabled ? 'disabled' : ''}>${I[f.icon]}</button>`).join('')}</div>`);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]'); if (!b || b.disabled) return;
    const id = b.dataset.filter;
    if (state.filters.has(id)) state.filters.delete(id); else state.filters.add(id);
    savePrefs();
    onChange();
  });
  return el;
}

// Шапка календарных экранов: меню · дом / переключатель / название с выпадающим выбором · поиск
export function calHeader({ swapIcon, swapTo, title, onTitle }) {
  const el = h(`<header class="hdr cal">
    <button class="hdr-btn" data-act="menu" aria-label="меню">${I.menu}</button>
    <button class="crumb" data-act="home" aria-label="домашнее представление">${I.home}</button>
    <span class="crumb-sep">/</span>
    <button class="crumb" data-act="swap" aria-label="сменить представление">${I[swapIcon]}</button>
    <span class="crumb-sep">/</span>
    <button class="cal-title" data-act="title">${title}<span class="chev">${I.chevDown}</span></button>
    <button class="hdr-btn" data-act="search" aria-label="поиск">${I.search}</button>
  </header>`);
  el.querySelector('[data-act=menu]').onclick = () => window.dispatchEvent(new CustomEvent('chronum:menu'));
  el.querySelector('[data-act=search]').onclick = () => { location.hash = '#/search'; };
  el.querySelector('[data-act=home]').onclick = () => { location.hash = state.home === 'day' ? `#/day/${state.day || todayStr()}` : `#/month/${state.month || ymOf(todayStr())}`; };
  el.querySelector('[data-act=swap]').onclick = () => { location.hash = swapTo(); };
  const t = el.querySelector('[data-act=title]');
  t.onclick = () => {
    const open = el.querySelector('.popover');
    if (open) { open.remove(); return; }
    const pop = onTitle();
    if (!pop) return;
    el.appendChild(pop);
    const off = (e) => { if (!pop.contains(e.target) && e.target !== t && !t.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); } };
    setTimeout(() => document.addEventListener('click', off), 0);
  };
  return el;
}

// Выпадающий выбор месяца и года
export function monthPicker(ym, onPick) {
  const [y0] = ym.split('-').map(Number);
  const pop = h('<div class="popover picker"></div>');
  let year = y0;
  function draw() {
    pop.innerHTML = '';
    const head = h(`<div class="pick-head"><button class="pick-nav" data-act="py">${I.back}</button><span>${year}</span><button class="pick-nav" data-act="ny">${I.fwd}</button></div>`);
    head.querySelector('[data-act=py]').onclick = (e) => { e.stopPropagation(); year--; draw(); };
    head.querySelector('[data-act=ny]').onclick = (e) => { e.stopPropagation(); year++; draw(); };
    pop.appendChild(head);
    const gridEl = h('<div class="pick-months"></div>');
    for (let m = 1; m <= 12; m++) {
      const val = `${year}-${String(m).padStart(2, '0')}`;
      const b = h(`<button class="${val === ym ? 'on' : ''}">${MONTHS_FULL[m - 1].slice(0, 3)}</button>`);
      b.onclick = () => { pop.remove(); onPick(val); };
      gridEl.appendChild(b);
    }
    pop.appendChild(gridEl);
  }
  draw();
  return pop;
}

// Выпадающий календарь для выбора дня
export function dayPicker(day, onPick) {
  const pop = h('<div class="popover picker"></div>');
  let ym = ymOf(day);
  function draw() {
    pop.innerHTML = '';
    const [y, m] = ym.split('-').map(Number);
    const head = h(`<div class="pick-head"><button class="pick-nav" data-act="pm">${I.back}</button><span>${MONTHS_FULL[m - 1]} ${y}</span><button class="pick-nav" data-act="nm">${I.fwd}</button></div>`);
    head.querySelector('[data-act=pm]').onclick = (e) => { e.stopPropagation(); ym = addMonths(ym, -1); draw(); };
    head.querySelector('[data-act=nm]').onclick = (e) => { e.stopPropagation(); ym = addMonths(ym, 1); draw(); };
    pop.appendChild(head);
    pop.appendChild(h(`<div class="pick-week">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>`));
    const gridEl = h('<div class="pick-days"></div>');
    for (const g of monthGrid(ym)) {
      const b = h(`<button class="${g.inMonth ? '' : 'dim'} ${g.date === day ? 'on' : ''}">${g.dom}</button>`);
      b.onclick = () => { pop.remove(); onPick(g.date); };
      gridEl.appendChild(b);
    }
    pop.appendChild(gridEl);
  }
  draw();
  return pop;
}

// Мультивыбор дней — диапазон дат для задачи
export function daysPicker(days, onDone) {
  const sel = new Set(days);
  const pop = h('<div class="popover picker"></div>');
  let ym = ymOf(days[0] || todayStr());
  function draw() {
    pop.innerHTML = '';
    const [y, m] = ym.split('-').map(Number);
    const head = h(`<div class="pick-head"><button class="pick-nav" data-act="pm">${I.back}</button><span>${MONTHS_FULL[m - 1]} ${y}</span><button class="pick-nav" data-act="nm">${I.fwd}</button></div>`);
    head.querySelector('[data-act=pm]').onclick = (e) => { e.stopPropagation(); ym = addMonths(ym, -1); draw(); };
    head.querySelector('[data-act=nm]').onclick = (e) => { e.stopPropagation(); ym = addMonths(ym, 1); draw(); };
    pop.appendChild(head);
    pop.appendChild(h(`<div class="pick-week">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>`));
    const gridEl = h('<div class="pick-days"></div>');
    for (const g of monthGrid(ym)) {
      const b = h(`<button class="${g.inMonth ? '' : 'dim'} ${sel.has(g.date) ? 'on' : ''}">${g.dom}</button>`);
      b.onclick = (e) => { e.stopPropagation(); if (sel.has(g.date)) sel.delete(g.date); else sel.add(g.date); draw(); };
      gridEl.appendChild(b);
    }
    pop.appendChild(gridEl);
    const foot = h(`<div class="row" style="margin-top:.6rem;justify-content:flex-end"><button class="btn small" data-act="ok" ${sel.size ? '' : 'disabled'}>готово</button></div>`);
    foot.querySelector('[data-act=ok]').onclick = (e) => { e.stopPropagation(); pop.remove(); onDone([...sel].sort()); };
    pop.appendChild(foot);
  }
  draw();
  return pop;
}

// Мультивыбор часов — куда ставится запись
export function hoursPicker(hours, onDone) {
  const sel = new Set(hours);
  const pop = h('<div class="popover picker"></div>');
  function draw() {
    pop.innerHTML = '';
    const g = h('<div class="hpick"></div>');
    for (let i = 0; i < 24; i++) {
      const b = h(`<button class="${sel.has(i) ? 'on' : ''}">${i}</button>`);
      b.onclick = (e) => { e.stopPropagation(); if (sel.has(i)) sel.delete(i); else sel.add(i); draw(); };
      g.appendChild(b);
    }
    pop.appendChild(g);
    const foot = h(`<div class="row" style="margin-top:.6rem;justify-content:flex-end"><button class="btn small" data-act="ok" ${sel.size ? '' : 'disabled'}>готово</button></div>`);
    foot.querySelector('[data-act=ok]').onclick = (e) => { e.stopPropagation(); pop.remove(); onDone([...sel].sort((x, y) => x - y)); };
    pop.appendChild(foot);
  }
  draw();
  return pop;
}

// Ячейка дня/часа: строки-наложения по активным фильтрам + нижняя строка с числом и звездочкой
export function cellRows(overlays, bottomHtml) {
  const act = activeFilters();
  const rows = Math.max(3, act.length + 1);
  let html = '';
  for (let i = 0; i < rows - 1; i++) {
    const o = act[i] ? overlays[act[i]] : null;
    html += `<span class="frow${o && o.cls ? ` ${o.cls}` : ''}"${o && o.style ? ` style="${o.style}"` : ''}>${o ? o.html : ''}</span>`;
  }
  return { rows, html: `${html}<span class="frow last">${bottomHtml}</span>` };
}

// Фон строки-наложения: диагональный градиент из макета
export function rowFill(rgb, a = 1) { return `background:linear-gradient(207deg, rgba(${rgb},${a}) 0%, rgba(${rgb},0) 85%)`; }
export const ROW_NEUTRAL = rowFill('38,38,38', 0.38);
export const ROW_OVER = rowFill('255,0,0', 1);
export const ROW_UNDER = rowFill('11,114,4', 1);

// разделитель блоков саммари
export function sumSep() { return h('<div class="sum-sep"></div>'); }

// кнопка-фильтр с всплывающим окном: какие виды показывать в инфографике и сортировка
export function filterButton(onChange) {
  const wrap = h(`<div style="position:relative;display:inline-block"><button class="sq-btn" aria-label="фильтр">${I.filter}</button></div>`);
  const btn = wrap.querySelector('button');
  btn.onclick = () => {
    const old = wrap.querySelector('.popover'); if (old) { old.remove(); return; }
    const kinds = KINDS.filter((k) => k !== 'money');
    const pop = h(`<div class="popover" style="left:0;top:6rem">
      ${kinds.map((k) => `<label><input type="checkbox" class="check" data-kind="${k}" ${state.hiddenKinds.has(k) ? '' : 'checked'}> <span class="ico" style="width:2rem;height:2rem">${I[KIND_ICON[k]]}</span> ${{ activity: 'занятия', food: 'еда', task: 'задачи', thought: 'мысли', counter: 'счётчики' }[k]}</label>`).join('')}
      <div class="seg"><button data-sort="weight" class="${state.sort === 'weight' ? 'on' : ''}">по весу</button><button data-sort="chrono" class="${state.sort === 'chrono' ? 'on' : ''}">по времени</button></div>
    </div>`);
    pop.addEventListener('change', (e) => { const k = e.target.dataset.kind; if (!k) return; if (e.target.checked) state.hiddenKinds.delete(k); else state.hiddenKinds.add(k); savePrefs(); onChange(); });
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-sort]'); if (!b) return; state.sort = b.dataset.sort; pop.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b)); savePrefs(); onChange(); });
    wrap.appendChild(pop);
    const off = (e) => { if (!wrap.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); } };
    setTimeout(() => document.addEventListener('click', off), 0);
  };
  return wrap;
}

export function sumLine(key, text, { done = false, files = 0, onClick, prefix = '' } = {}) {
  const el = h(`<button class="sum-line"><span class="k">${esc(key)}</span><span class="t ${done ? 'done' : ''}">${done ? `<span class="done-ck">${I.checkBold}</span>` : ''}${prefix}${esc(text)}</span>${files ? `<span class="files">${I.paperclip}${files}</span>` : ''}</button>`);
  if (onClick) el.onclick = onClick;
  return el;
}
