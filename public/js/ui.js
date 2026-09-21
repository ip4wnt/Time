// Общие элементы интерфейса: шапка, диалоги, всплывающие сообщения.
import { I } from './icons.js';
import { esc } from './state.js';

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function header({ title, icon, left = 'menu', onLeft, search = true }) {
  const el = h(`<header class="hdr">
    <button class="hdr-btn" data-act="left" aria-label="${left === 'menu' ? 'меню' : 'закрыть'}">${left === 'menu' ? I.menu : I.close}</button>
    <div class="hdr-title"><span>${esc(title)}</span>${icon ? I[icon] : ''}</div>
    ${search ? `<button class="hdr-btn" data-act="search" aria-label="поиск">${I.search}</button>` : '<span style="width:4rem"></span>'}
  </header>`);
  el.querySelector('[data-act=left]').addEventListener('click', () => onLeft ? onLeft() : window.dispatchEvent(new CustomEvent('chronum:menu')));
  const s = el.querySelector('[data-act=search]');
  if (s) s.addEventListener('click', () => { location.hash = '#/search'; });
  return el;
}

let toastTimer = null;
export function toast(text, ms = 2500) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h(`<div class="toast">${esc(text)}</div>`);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

// dialog({title, body(html|element), actions:[{label, value, cls}]}) → Promise(value|null)
export function dialog({ title, body = '', actions = [{ label: 'ок', value: true }], cancel = true, onOpen }) {
  return new Promise((resolve) => {
    const back = h(`<div class="dlg-back"><div class="dlg" role="dialog">${title ? `<div class="dlg-title">${esc(title)}</div>` : ''}<div class="dlg-body"></div><div class="dlg-actions"></div></div></div>`);
    const bodyEl = back.querySelector('.dlg-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const acts = back.querySelector('.dlg-actions');
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    if (cancel) { const b = h(`<button class="btn small ghost">отменить</button>`); b.onclick = () => close(null); acts.appendChild(b); }
    for (const a of actions) { const b = h(`<button class="btn small ${a.cls || ''}">${esc(a.label)}</button>`); b.onclick = () => close(typeof a.value === 'function' ? a.value(bodyEl) : a.value); acts.appendChild(b); }
    const onKey = (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const last = actions[actions.length - 1]; close(typeof last.value === 'function' ? last.value(bodyEl) : last.value); } };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    document.getElementById('overlay').appendChild(back);
    if (onOpen) onOpen(bodyEl);
    const f = bodyEl.querySelector('input,textarea'); if (f) { f.focus(); if (f.select) f.select(); }
  });
}

export async function prompt(title, value = '', placeholder = '') {
  return dialog({ title, body: `<input class="field" value="${esc(value)}" placeholder="${esc(placeholder)}">`, actions: [{ label: 'готово', value: (b) => b.querySelector('input').value.trim() }] });
}
export async function confirm(title, okLabel = 'да') {
  return dialog({ title, body: '', actions: [{ label: okLabel, value: true, cls: 'danger' }] });
}

export function spinner() { return h('<div class="spin">…</div>'); }
