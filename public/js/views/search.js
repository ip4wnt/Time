// Поиск по событиям, заметкам, датам и занятиям.
import { I, KIND_ICON } from '../icons.js';
import { get } from '../api.js';
import { esc, humanDate, hoursLabel, activity, MOOD_COLOR } from '../state.js';
import { h, header } from '../ui.js';

export async function renderSearch(q = {}) {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'поиск', icon: 'search', left: 'close', onLeft: () => history.back(), search: false }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  const form = h(`<form class="search-in"><input class="field" type="search" placeholder="что ищем?" value="${esc(q.q || '')}" autocomplete="off"><button class="btn" type="submit" aria-label="искать">${I.search}</button></form>`);
  page.appendChild(form);
  const results = h('<div class="results"></div>');
  page.appendChild(results);
  const inp = form.querySelector('input');
  inp.focus();

  let t = null;
  form.onsubmit = (e) => { e.preventDefault(); run(inp.value); };
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => run(inp.value), 350); });

  async function run(text) {
    const s = text.trim();
    history.replaceState(null, '', `#/search?q=${encodeURIComponent(s)}`);
    if (s.length < 2) { results.innerHTML = '<p class="p">введите хотя бы два символа</p>'; return; }
    let r;
    try { r = await get(`/api/search?q=${encodeURIComponent(s)}`); } catch (e) { results.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if (inp.value.trim() !== s) return;
    results.innerHTML = '';
    const total = r.events.length + r.notes.length + r.dates.length + r.activities.length;
    if (!total) { results.innerHTML = '<p class="p">ничего не нашлось</p>'; return; }
    const mark = (str) => esc(str).replace(new RegExp(escapeRe(s), 'gi'), (m) => `<b>${m}</b>`);
    if (r.events.length) {
      results.appendChild(h(`<h3>события · ${r.events.length}</h3>`));
      for (const e of r.events) {
        const a = e.activity_id ? activity(e.activity_id) : null;
        const when = e.kind === 'task' ? `задача · ${humanDate(e.day)}` : `${humanDate(e.day)} · ${hoursLabel(e.hours || [])}`;
        const dot = a ? `<i class="mood-dot" style="background:${a.color}"></i>` : e.kind === 'thought' ? `<i class="mood-dot" style="background:${MOOD_COLOR[e.mood || 'neutral']}"></i>` : `<span class="ico" style="display:inline-block;width:1.6rem;height:1.6rem;vertical-align:middle;margin-right:.6rem">${I[KIND_ICON[e.kind]]}</span>`;
        const el = h(`<button class="res"><span class="k">${when}</span><div>${dot}${mark(e.text || (a ? a.name : ''))}</div></button>`);
        el.onclick = () => { location.hash = e.kind === 'task' ? `#/add?days=${e.days.join(',')}&kind=task&edit=${e.id}` : `#/add?day=${e.day}&hours=${(e.hours || []).join(',')}&edit=${e.id}`; };
        results.appendChild(el);
      }
    }
    if (r.notes.length) {
      results.appendChild(h(`<h3>заметки · ${r.notes.length}</h3>`));
      for (const n of r.notes) {
        const el = h(`<a class="res" href="#/notes/${n.kind === 'note' ? n.id : ''}"><span class="k">${n.kind === 'folder' ? 'папка' : 'заметка'}</span>${mark(n.title)}${n.snippet ? `<div class="snip">${esc(n.snippet).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')}</div>` : ''}</a>`);
        results.appendChild(el);
      }
    }
    if (r.dates.length) {
      results.appendChild(h(`<h3>важные даты · ${r.dates.length}</h3>`));
      for (const d of r.dates) results.appendChild(h(`<a class="res" href="#/day/${d.day}"><span class="k">${humanDate(d.day)}${d.yearly ? ' · ежегодно' : ''}</span>${mark(d.title)}</a>`));
    }
    if (r.activities.length) {
      results.appendChild(h(`<h3>занятия · ${r.activities.length}</h3>`));
      for (const a of r.activities) results.appendChild(h(`<a class="res" href="#/activities"><i class="mood-dot" style="background:${a.color}"></i>${mark(a.name)} <span class="k">${a.n} записей</span></a>`));
    }
  }
  if (q.q) run(q.q);
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
