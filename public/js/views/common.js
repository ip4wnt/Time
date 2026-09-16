// Общие блоки календарных экранов: навигация, режимы, фильтр, строки саммари.
import { I, KIND_ICON } from '../icons.js';
import { state, savePrefs, esc, KINDS } from '../state.js';
import { h } from '../ui.js';

export const MODES = [
  { id: 'activities', icon: 'palette', title: 'занятия' },
  { id: 'food', icon: 'apple', title: 'еда' },
  { id: 'tasks', icon: 'list', title: 'задачи' },
  { id: 'money', icon: 'ruble', title: 'деньги', disabled: true },
  { id: 'thoughts', icon: 'cloud', title: 'мысли' },
];
export const MODE_KIND = { activities: 'activity', food: 'food', tasks: 'task', thoughts: 'thought' };
export const MODE_TITLE = { activities: 'занятия', food: 'еда', tasks: 'задачи', thoughts: 'мысли' };

export function modesBar(onChange) {
  const el = h(`<div class="modes">${MODES.map((m) => `<button class="mode ${state.mode === m.id ? 'on' : ''} ${m.disabled ? 'off' : ''}" data-mode="${m.id}" title="${m.title}" ${m.disabled ? 'disabled' : ''}>${I[m.icon]}</button>`).join('')}
    <button class="mode ${state.counterOn ? 'on' : 'dim'}" data-mode="counter" title="показывать счётчик">${I.timer}</button></div>`);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b || b.disabled) return;
    if (b.dataset.mode === 'counter') state.counterOn = !state.counterOn;
    else state.mode = b.dataset.mode;
    savePrefs();
    onChange();
  });
  return el;
}

export function calNav({ up, upDisabled, down, downDisabled, prev, next, title }) {
  const el = h(`<div class="calnav">
    <button class="nav-btn" data-act="up" ${upDisabled ? 'disabled' : ''} aria-label="выше">${I.levelUp}</button>
    <div class="nav-mid">
      <button class="nav-btn" data-act="prev" aria-label="назад">${I.back}</button>
      <div class="nav-title">${title}</div>
      <button class="nav-btn" data-act="next" aria-label="вперёд">${I.fwd}</button>
    </div>
    <button class="nav-btn" data-act="down" ${downDisabled ? 'disabled' : ''} aria-label="ниже">${I.levelDown}</button>
  </div>`);
  el.querySelector('[data-act=up]').onclick = up;
  el.querySelector('[data-act=down]').onclick = down;
  el.querySelector('[data-act=prev]').onclick = prev;
  el.querySelector('[data-act=next]').onclick = next;
  return el;
}

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
  const el = h(`<button class="sum-line"><span class="k">${esc(key)}</span><span class="t ${done ? 'done' : ''}">${prefix}${esc(text)}</span>${files ? `<span class="files">${I.paperclip}${files}</span>` : ''}</button>`);
  if (onClick) el.onclick = onClick;
  return el;
}

// Список сущностей для инфографики: пары {color} для занятий; {icon} для остальных видов
export function graphItems(hourMapArr, { sort, hidden, excludeSleep = true, isSleep }) {
  const items = [];
  for (let hIdx = 0; hIdx < hourMapArr.length; hIdx++) {
    const hm = hourMapArr[hIdx];
    for (const e of hm.all) {
      if (hidden.has(e.kind)) continue;
      if (e.kind === 'activity') {
        if (e !== hm.all.find((x) => x.kind === 'activity')) continue; // за час — одно занятие
        if (excludeSleep && isSleep(e)) continue;
      }
      items.push({ hour: hIdx, e });
    }
  }
  return items;
}
