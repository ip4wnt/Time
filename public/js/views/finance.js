// Финансы: бюджет года или отдельный бюджет (проект, задача).
// Структура: расходы и доходы → разделы (сворачиваются) → подразделы (с подписью или просто чертой) → статьи.
// Статья хранит план; исполнение фиксируется отдельными записями и показывается приглушённо.
import { I } from '../icons.js';
import { get, post, put, del } from '../api.js';
import { state, todayStr, esc } from '../state.js';
import { h, toast, prompt, confirm } from '../ui.js';
import { calHeader } from './common.js';

const NB = '\u00a0';
const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, NB);
// 94000 → «94 000», 1250.5 → «1 250,5»
export function fmt(n) {
  const v = Math.round(Number(n) * 100) / 100;
  const [i, f] = String(Math.abs(v)).split('.');
  return (v < 0 ? '−' : '') + group(i) + (f ? `,${f}` : '');
}
// сумма раздела — округлённо до тысяч: «243к»
export function fmtK(n) {
  const v = Number(n) || 0;
  const k = Math.round(Math.abs(v) / 1000);
  if (!k) return v === 0 ? '0к' : `${v < 0 ? '−' : ''}&lt;1к`;
  return `${v < 0 ? '−' : ''}${group(String(k))}к`;
}
// «5000», «5 000», «1250*12», «1250х12»
export function parseAmt(s) {
  const t = String(s ?? '').toLowerCase().replace(/[\s\u00a0]/g, '').replace(/,/g, '.').replace(/[xх×]/g, '*');
  if (!t) return NaN;
  if (!/^[0-9.]+([*+\-/][0-9.]+)*$/.test(t)) return NaN;
  try { const v = Function(`"use strict";return (${t})`)(); return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; } catch { return NaN; }
}

const HOLD_MS = 2000;
const SIDE_TITLE = { expense: 'Расходы', income: 'Доходы' };
const ICON = {
  section: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="22" height="7" rx="1"/><path d="M5 17h18M5 22h12"/></svg>',
  divider: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="9" width="12" height="6" rx="1"/><path d="M5 21h18"/></svg>',
  line: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 14h10"/></svg>',
};

export async function renderFin(parts) {
  const app = document.getElementById('app');
  document.body.classList.add('bg-fin');
  const mode = parts[1] === 'b' ? 'b' : 'year';
  const year = Number(parts[2]) || new Date().getFullYear();
  const q = mode === 'b' ? `id=${Number(parts[2])}` : `year=${year}`;

  let D = null;          // { budget, nodes, tx }
  let ed = null;         // что сейчас редактируется
  let budgets = [];      // список для выбора
  const cleanups = [];

  const hdrHost = h('<div></div>');
  const page = h('<div class="fin"></div>');
  app.append(hdrHost, page);
  page.appendChild(h('<p class="p" style="padding:3rem 2.2rem">загрузка…</p>'));

  async function load() {
    D = await get(`/api/fin/budget?${q}`);
    budgets = (await get('/api/fin/budgets')).budgets;
  }
  const reload = async () => { D = await get(`/api/fin/budget?id=${D.budget.id}`); draw(); };
  try { await load(); } catch (e) { page.innerHTML = `<p class="err" style="padding:3rem 2.2rem">${esc(e.message)}</p>`; return () => document.body.classList.remove('bg-fin'); }

  const isYear = D.budget.kind === 'year';
  hdrHost.appendChild(calHeader({
    swapIcon: 'ruble',
    swapTo: () => `#/fin/year/${new Date().getFullYear()}`,
    title: esc(isYear ? String(D.budget.year) : D.budget.name),
    onTitle: () => picker(),
  }));

  // ---------- вычисления ----------
  let kids, txSum;
  function index() {
    kids = new Map(); txSum = new Map();
    for (const n of D.nodes) { const k = `${n.side}:${n.parent_id ?? ''}`; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); }
    for (const t of D.tx) txSum.set(t.node_id, (txSum.get(t.node_id) || 0) + t.amount);
  }
  const childrenOf = (side, pid) => kids.get(`${side}:${pid ?? ''}`) || [];
  const byId = (id) => D.nodes.find((n) => n.id === id);
  // статья: план, исполнено, осталось, итог (если перерасход — просто факт)
  function itemVals(n) {
    const done = txSum.get(n.id) || 0;
    return { plan: n.plan, done, rest: Math.max(n.plan - done, 0), total: Math.max(n.plan, done) };
  }
  function total(n) {
    if (n.type === 'item') return itemVals(n).total;
    return childrenOf(n.side, n.id).reduce((s, c) => s + total(c), 0);
  }
  const sideTotal = (side) => childrenOf(side, null).reduce((s, c) => s + total(c), 0);

  // ---------- отрисовка ----------
  function draw() {
    index();
    const scroll = window.scrollY;
    page.innerHTML = '';
    page.appendChild(part('expense'));
    page.appendChild(part('income'));
    const bal = sideTotal('income') - sideTotal('expense');
    page.appendChild(h(`<section class="fin-part fin-balance"><div class="fin-big"><span class="fin-big-t">Баланс</span><span class="fin-sum">${fmtK(bal)}</span></div></section>`));
    if (isYear) {
      const c = h('<div class="fin-carry"><button>перенести весь бюджет в новый год</button></div>');
      c.firstElementChild.onclick = carry;
      page.appendChild(c);
    }
    renderPanel();
    window.scrollTo(0, scroll);
  }

  async function carry() {
    const to = D.budget.year + 1;
    if (!(await confirm(`Перенести плановые суммы, разделы, подразделы и статьи в ${to} год? Исполнение не переносится.`, 'перенести'))) return;
    try { const r = await post('/api/fin/carry', { budget_id: D.budget.id }); toast(`Перенесено в ${r.year} год`); location.hash = `#/fin/year/${r.year}`; } catch (e) { toast(e.message); }
  }

  function part(side) {
    const el = h(`<section class="fin-part" data-side="${side}"><div class="fin-big"><span class="fin-big-t">${SIDE_TITLE[side]}</span><span class="fin-sum">${fmtK(sideTotal(side))}</span></div><div class="fin-body"></div></section>`);
    const body = el.querySelector('.fin-body');
    container(body, side, null, null);
    return el;
  }

  // содержимое контейнера: статьи, пустая строка, затем подразделы, затем разделы
  function container(box, side, parent, parentNode) {
    const list = childrenOf(side, parent);
    const items = list.filter((n) => n.type === 'item');
    const divs = list.filter((n) => n.type === 'divider');
    const secs = list.filter((n) => n.type === 'section');
    for (const n of items) box.appendChild(itemRow(n));
    box.appendChild(emptyRow(side, parent, !list.length && !parentNode));
    for (const d of divs) box.appendChild(dividerBlock(d));
    for (const s of secs) box.appendChild(sectionBlock(s));
    if (!parent) { const f = box.querySelector(':scope > .fin-sec'); if (f) f.classList.add('first'); }
  }

  function emptyRow(side, parent, hint) {
    if (ed && ed.type === 'new-item' && ed.side === side && (ed.parent_id ?? null) === (parent ?? null)) return editRow({ type: 'item', isNew: true, side, parent });
    const el = h(`<div class="fin-empty" data-side="${side}" data-parent="${parent ?? ''}">${hint ? '<span class="fin-hint">добавить статью</span>' : ''}</div>`);
    el.onclick = () => { ed = { type: 'new-item', side, parent_id: parent }; draw(); focusEdit(); };
    return el;
  }

  function itemRow(n) {
    if (ed && ed.type === 'item' && ed.id === n.id) return editRow({ type: 'item', node: n });
    const v = itemVals(n);
    const fully = v.done > 0 && v.rest === 0;
    let amount;
    if (fully) amount = `<span class="fin-done">${fmt(v.done)}</span>`;
    else if (v.done > 0) amount = `<span class="fin-done">${fmt(v.done)}</span><span>${fmt(v.rest)}</span>`;
    else amount = `<span>${fmt(v.plan)}</span>`;
    const el = h(`<div class="fin-item ${fully ? 'is-done' : ''}" data-id="${n.id}" data-parent="${n.parent_id ?? ''}" data-side="${n.side}" data-hold="${n.id}"><button class="fin-name">${esc(n.title)}</button><button class="fin-amt">${amount}</button></div>`);
    el.querySelector('.fin-name').onclick = () => { ed = { type: 'item', id: n.id }; draw(); focusEdit(); };
    el.querySelector('.fin-amt').onclick = () => openSheet(n.id);
    return el;
  }

  function dividerBlock(d) {
    const wrap = h(`<div class="fin-div" data-id="${d.id}" data-parent="${d.parent_id ?? ''}" data-side="${d.side}"></div>`);
    if (ed && ed.type === 'divider' && ed.id === d.id) wrap.appendChild(editRow({ type: 'divider', node: d }));
    else {
      const head = h(`<button class="fin-dhead" data-hold="${d.id}">${d.title ? `<span class="fin-chip">${esc(d.title)}</span>` : '<span class="fin-line"></span>'}</button>`);
      head.onclick = () => { ed = { type: 'divider', id: d.id }; draw(); focusEdit(); };
      wrap.appendChild(head);
    }
    const inner = h('<div class="fin-dbody"></div>');
    container(inner, d.side, d.id, d);
    wrap.appendChild(inner);
    return wrap;
  }

  function sectionBlock(s) {
    const wrap = h(`<div class="fin-sec ${s.collapsed ? 'collapsed' : ''}" data-id="${s.id}" data-parent="" data-side="${s.side}"></div>`);
    if (ed && ed.type === 'section' && ed.id === s.id) wrap.appendChild(h('<div class="fin-shead-gap"></div>')), wrap.appendChild(editRow({ type: 'section', node: s }));
    else {
      const head = h(`<div class="fin-shead" data-hold="${s.id}"><button class="fin-chev" aria-label="свернуть или развернуть">${I.chevDown}</button><button class="fin-stitle">${esc(s.title)}</button><span class="fin-sum">${fmtK(total(s))}</span></div>`);
      head.querySelector('.fin-chev').onclick = async () => { s.collapsed = !s.collapsed; draw(); put(`/api/fin/nodes/${s.id}`, { collapsed: s.collapsed }).catch((e) => toast(e.message)); };
      head.querySelector('.fin-stitle').onclick = () => { ed = { type: 'section', id: s.id }; draw(); focusEdit(); };
      wrap.appendChild(head);
    }
    if (!s.collapsed) { const inner = h('<div class="fin-sbody"></div>'); container(inner, s.side, s.id, s); wrap.appendChild(inner); }
    return wrap;
  }

  // ---------- редактирование на месте ----------
  function editRow({ type, node, isNew, side, parent }) {
    const withAmt = type === 'item';
    const label = { item: 'название статьи', section: 'название раздела', divider: 'подпись подраздела (можно пусто — будет черта)' }[type];
    const el = h(`<div class="fin-edit fin-edit-${type}">
      <div class="fin-edit-row"><input class="fin-in fin-in-t" placeholder="${label}" maxlength="200" value="${esc(node ? node.title : '')}">${withAmt ? `<input class="fin-in fin-in-a" inputmode="decimal" placeholder="сумма" value="${node && node.plan ? String(node.plan).replace('.', ',') : ''}">` : ''}</div>
      <div class="fin-edit-btns"><button class="fin-b ok" data-a="save">сохранить</button><button class="fin-b" data-a="cancel">отмена</button>${node ? `<button class="fin-b danger" data-a="del">${type === 'item' ? 'удалить статью' : type === 'section' ? 'удалить раздел' : 'удалить подраздел'}</button>` : ''}</div>
    </div>`);
    const tIn = el.querySelector('.fin-in-t'); const aIn = el.querySelector('.fin-in-a');
    const close = async (drop) => {
      const fresh = ed && ed.fresh && ed.id;
      ed = null;
      if (drop && fresh) { try { await del(`/api/fin/nodes/${fresh}`); } catch { /* ignore */ } await reload(); } else draw();
    };
    async function save() {
      const title = tIn.value.trim();
      const plan = aIn ? (aIn.value.trim() === '' ? 0 : parseAmt(aIn.value)) : undefined;
      if (aIn && Number.isNaN(plan)) { toast('Сумма не распознана'); return; }
      if (type !== 'divider' && !title) { toast('Введите название'); return; }
      try {
        if (node) await put(`/api/fin/nodes/${node.id}`, { title, ...(aIn ? { plan } : {}) });
        else await post('/api/fin/nodes', { budget_id: D.budget.id, side, parent_id: parent ?? null, type: 'item', title, plan });
        ed = null; await reload();
      } catch (e) { toast(e.message); }
    }
    async function remove() {
      // статья и подраздел удаляются сразу, раздел — с подтверждением
      if (type === 'section' && !(await confirm(`Удалить раздел «${node.title}» со всеми статьями?`, 'удалить'))) return;
      try { await del(`/api/fin/nodes/${node.id}`); ed = null; await reload(); } catch (e) { toast(e.message); }
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'save') save(); else if (b.dataset.a === 'cancel') close(true); else remove();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });
    return el;
  }
  function focusEdit() { const i = page.querySelector('.fin-edit .fin-in-t'); if (i) { i.focus(); i.select(); i.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }

  // ---------- нижняя панель: разделы и подразделы ----------
  function renderPanel() {
    document.querySelectorAll('.fin-panel').forEach((p) => p.remove());
    if (!ed || ed.type !== 'new-item') return;
    const p = h(`<div class="fin-panel">
      <button data-k="section">${ICON.section}<span>раздел</span></button>
      <button data-k="divider">${ICON.divider}<span>подраздел</span></button>
      <button data-k="line">${ICON.line}<span>черта</span></button>
    </div>`);
    p.addEventListener('pointerdown', (e) => e.preventDefault()); // не гасим фокус поля ввода
    p.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) addStructure(b.dataset.k); });
    document.body.appendChild(p);
  }

  // новый раздел или подраздел ставится после того, внутри чего сейчас стоит пустая строка
  async function addStructure(kind) {
    const { side, parent_id } = ed;
    const cur = parent_id != null ? byId(parent_id) : null;
    let type = kind === 'section' ? 'section' : 'divider';
    let parent = null; let after = null; // after — узел, после которого вставить
    if (type === 'section') { parent = null; after = cur ? (cur.type === 'section' ? cur : byId(cur.parent_id)) : null; }
    else if (!cur) parent = null;
    else if (cur.type === 'section') parent = cur.id;
    else { parent = cur.parent_id; after = cur; } // внутри подраздела — рядом с ним
    try {
      const n = await post('/api/fin/nodes', { budget_id: D.budget.id, side, parent_id: parent, type, title: '' + (type === 'section' ? 'Новый раздел' : '') });
      if (after) {
        const sibs = D.nodes.filter((x) => x.side === side && (x.parent_id ?? null) === parent && x.type === type);
        const i = sibs.findIndex((x) => x.id === after.id);
        const nxt = sibs[i + 1];
        if (nxt) await put('/api/fin/move', { id: n.id, parent_id: parent, before_id: nxt.id });
      }
      await reload();
      if (kind === 'line') { ed = null; draw(); return; }
      ed = { type, id: n.id, fresh: kind === 'divider' || type === 'section' ? n.id : null }; draw(); focusEdit();
    } catch (e) { toast(e.message); }
  }

  // ---------- окно статьи: план и записи исполнения ----------
  function openSheet(nodeId) {
    const back = h('<div class="dlg-back"><div class="dlg fin-sheet" role="dialog"></div></div>');
    const dlg = back.firstElementChild;
    let editTx = null;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); draw(); };
    const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest('input')) close(); };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });

    function paint() {
      const n = byId(nodeId); if (!n) { close(); return; }
      index();
      const v = itemVals(n);
      const txs = D.tx.filter((t) => t.node_id === nodeId).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.id - a.id));
      dlg.innerHTML = `<div class="dlg-title">${esc(n.title)}</div>
        <label class="fin-lab">план<input class="fin-in" data-f="plan" inputmode="decimal" value="${n.plan ? String(n.plan).replace('.', ',') : ''}" placeholder="0"></label>
        <div class="fin-sum-line"><span>исполнено ${fmt(v.done)}</span><span>${v.done > v.plan ? `сверх плана ${fmt(v.done - v.plan)}` : `осталось ${fmt(v.rest)}`}</span></div>
        <div class="fin-txs">${txs.map((t) => (editTx === t.id
          ? `<div class="fin-tx editing" data-id="${t.id}"><input class="fin-in" data-f="ta" inputmode="decimal" value="${String(t.amount).replace('.', ',')}"><input class="fin-in" data-f="tn" placeholder="комментарий" value="${esc(t.note)}"><button class="fin-b ok" data-a="tsave">ok</button><button class="fin-b" data-a="tcancel">×</button></div>`
          : `<div class="fin-tx" data-id="${t.id}"><button class="fin-tx-main" data-a="tedit"><span class="d">${esc(t.day.slice(8, 10) + '.' + t.day.slice(5, 7))}</span><span class="a">${fmt(t.amount)}</span><span class="n">${esc(t.note)}${t.event_id ? ' · из трекера' : ''}</span></button><button class="fin-tx-del" data-a="tdel" aria-label="удалить запись">${I.close}</button></div>`)).join('') || '<p class="fin-none">записей исполнения пока нет</p>'}</div>
        <div class="fin-add"><input class="fin-in" data-f="amt" inputmode="decimal" placeholder="исполнено"><input class="fin-in" data-f="note" placeholder="комментарий"><button class="fin-b ok" data-a="tadd">внести</button></div>
        ${v.rest > 0 ? `<button class="fin-b wide" data-a="rest">исполнить остаток ${fmt(v.rest)}</button>` : ''}
        <div class="dlg-actions"><button class="btn small" data-a="close">готово</button></div>`;
    }
    async function run(fn) { try { await fn(); await refresh(); } catch (e) { toast(e.message); } }
    async function refresh() { D = await get(`/api/fin/budget?id=${D.budget.id}`); paint(); }
    const val = (f) => dlg.querySelector(`[data-f=${f}]`);
    const addTx = (amount, note) => run(async () => { await post('/api/fin/tx', { node_id: nodeId, amount, note, day: todayStr() }); });
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const row = b.closest('.fin-tx'); const id = row ? Number(row.dataset.id) : null;
      switch (b.dataset.a) {
        case 'close': close(); break;
        case 'tadd': { const a = parseAmt(val('amt').value); if (!(a > 0)) { toast('Введите сумму'); return; } addTx(a, val('note').value.trim()); break; }
        case 'rest': addTx(itemVals(byId(nodeId)).rest, ''); break;
        case 'tedit': editTx = id; paint(); { const i = val('ta'); if (i) { i.focus(); i.select(); } } break;
        case 'tcancel': editTx = null; paint(); break;
        case 'tsave': { const a = parseAmt(val('ta').value); if (!(a > 0)) { toast('Введите сумму'); return; } const note = val('tn').value.trim(); editTx = null; run(() => put(`/api/fin/tx/${id}`, { amount: a, note })); break; }
        case 'tdel': run(() => del(`/api/fin/tx/${id}`)); break;
        default:
      }
    });
    dlg.addEventListener('change', (e) => {
      if (e.target.dataset.f !== 'plan') return;
      const raw = e.target.value.trim(); const p = raw === '' ? 0 : parseAmt(raw);
      if (Number.isNaN(p)) { toast('Сумма не распознана'); return; }
      run(() => put(`/api/fin/nodes/${nodeId}`, { plan: p }));
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const f = e.target.dataset && e.target.dataset.f;
      if (f === 'amt' || f === 'note') dlg.querySelector('[data-a=tadd]').click();
      else if (f === 'ta' || f === 'tn') dlg.querySelector('[data-a=tsave]').click();
      else if (f === 'plan') e.target.blur();
    });
    paint();
    document.getElementById('overlay').appendChild(back);
    const first = dlg.querySelector('[data-f=amt]'); if (first && !byId(nodeId).plan) first.focus();
  }

  // ---------- выбор года и бюджетов ----------
  function picker() {
    const pop = h('<div class="popover picker fin-pick"></div>');
    let base = (isYear ? D.budget.year : new Date().getFullYear()) - 4;
    const pick = (hash) => { pop.remove(); location.hash = hash; };
    function drawPick() {
      pop.innerHTML = '';
      const head = h(`<div class="pick-head"><button class="pick-nav" data-a="p">${I.back}</button><span>${base}–${base + 8}</span><button class="pick-nav" data-a="n">${I.fwd}</button></div>`);
      head.querySelector('[data-a=p]').onclick = (e) => { e.stopPropagation(); base -= 9; drawPick(); };
      head.querySelector('[data-a=n]').onclick = (e) => { e.stopPropagation(); base += 9; drawPick(); };
      pop.appendChild(head);
      const have = new Set(budgets.filter((b) => b.kind === 'year').map((b) => b.year));
      const g = h('<div class="pick-months"></div>');
      for (let y = base; y < base + 9; y++) {
        const b = h(`<button class="${isYear && y === D.budget.year ? 'on' : ''} ${have.has(y) ? 'has' : ''}">${y}</button>`);
        b.onclick = () => pick(`#/fin/year/${y}`);
        g.appendChild(b);
      }
      pop.appendChild(g);
      const customs = budgets.filter((b) => b.kind === 'custom');
      if (customs.length) {
        const list = h('<div class="fin-blist"></div>');
        for (const b of customs) {
          const row = h(`<div class="fin-brow ${!isYear && b.id === D.budget.id ? 'on' : ''}"><button class="fin-bname">${esc(b.name)}</button><button class="fin-bico" data-a="ren" aria-label="переименовать">${I.pencil}</button><button class="fin-bico" data-a="del" aria-label="удалить бюджет">${I.trash}</button></div>`);
          row.querySelector('.fin-bname').onclick = () => pick(`#/fin/b/${b.id}`);
          row.querySelector('[data-a=ren]').onclick = async (e) => {
            e.stopPropagation(); pop.remove();
            const name = await prompt('название бюджета', b.name);
            if (!name) return;
            try { await put(`/api/fin/budgets/${b.id}`, { name }); location.reload(); } catch (err) { toast(err.message); }
          };
          row.querySelector('[data-a=del]').onclick = async (e) => {
            e.stopPropagation(); pop.remove();
            if (!(await confirm(`Удалить бюджет «${b.name}» со всеми статьями и записями?`, 'удалить'))) return;
            try { await del(`/api/fin/budgets/${b.id}`); if (!isYear && b.id === D.budget.id) location.hash = `#/fin/year/${new Date().getFullYear()}`; location.reload(); } catch (err) { toast(err.message); }
          };
          list.appendChild(row);
        }
        pop.appendChild(list);
      }
      const nb = h(`<button class="btn small wide fin-new">${I.plus} создать бюджет</button>`);
      nb.onclick = async (e) => {
        e.stopPropagation(); pop.remove();
        const name = await prompt('название бюджета', '', 'например: ремонт дачи');
        if (!name) return;
        try { const b = await post('/api/fin/budgets', { name }); location.hash = `#/fin/b/${b.id}`; } catch (err) { toast(err.message); }
      };
      pop.appendChild(nb);
    }
    drawPick();
    return pop;
  }

  // ---------- перетаскивание: удержание 2 секунды ----------
  const drag = setupDrag();
  function setupDrag() {
    let timer = null; let st = null; let blockClick = false;
    const prevent = (e) => { if (st && st.active && e.cancelable) e.preventDefault(); };
    const cancelHold = () => { clearTimeout(timer); timer = null; };
    const onDown = (e) => {
      if (e.button != null && e.button > 0) return;
      if (ed) return; // во время редактирования переносить нельзя
      const holdEl = e.target.closest('[data-hold]');
      if (!holdEl || e.target.closest('.fin-chev')) return;
      cancelHold();
      st = { holdEl, id: Number(holdEl.dataset.hold), x: e.clientX, y: e.clientY, pid: e.pointerId, active: false };
      timer = setTimeout(() => begin(), HOLD_MS);
    };
    const onMove = (e) => {
      if (!st) return;
      if (!st.active) { if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) { cancelHold(); st = null; } return; }
      e.preventDefault();
      st.cy = e.clientY;
      update();
    };
    const onUp = async () => {
      cancelHold();
      if (!st) return;
      const s = st; st = null;
      if (!s.active) return;
      s.active = false;
      cancelAnimationFrame(s.raf);
      blockClick = true; setTimeout(() => { blockClick = false; }, 300);
      s.unit.classList.remove('lifted'); s.unit.style.transform = '';
      s.line.remove(); document.body.classList.remove('fin-dragging');
      const slot = s.slot;
      if (slot && !(slot.parent === s.node.parent_id && slot.before === s.node.id)) {
        try { await put('/api/fin/move', { id: s.node.id, parent_id: slot.parent, before_id: slot.before }); } catch (err) { toast(err.message); }
        await reload();
      }
    };
    function begin() {
      timer = null;
      if (!st) return;
      const node = byId(st.id); if (!node) { st = null; return; }
      const unit = node.type === 'item' ? st.holdEl : st.holdEl.closest('.fin-sec, .fin-div');
      if (!unit) { st = null; return; }
      st.active = true; st.node = node; st.unit = unit; st.cy = st.y;
      st.startPageY = st.y + window.scrollY;
      unit.classList.add('lifted');
      document.body.classList.add('fin-dragging');
      if (navigator.vibrate) navigator.vibrate(30);
      st.slots = slotsFor(node, unit);
      st.line = h('<div class="fin-dropline"></div>');
      document.body.appendChild(st.line);
      update();
      const tick = () => { if (!st || !st.active) return; const y = st.cy; if (y < 90) window.scrollBy(0, -14); else if (y > window.innerHeight - 110) window.scrollBy(0, 14); update(); st.raf = requestAnimationFrame(tick); };
      st.raf = requestAnimationFrame(tick);
    }
    function update() {
      const s = st; if (!s || !s.active) return;
      const pageY = s.cy + window.scrollY;
      s.unit.style.transform = `translateY(${pageY - s.startPageY}px)`;
      let best = null; let bd = Infinity;
      for (const sl of s.slots) { const d = Math.abs(sl.y - pageY); if (d < bd) { bd = d; best = sl; } }
      s.slot = best;
      if (best) { s.line.style.display = 'block'; s.line.style.top = `${best.y - window.scrollY}px`; } else s.line.style.display = 'none';
    }
    // допустимые места, куда можно уронить: считаем один раз, пока вёрстка неподвижна
    function slotsFor(node, unit) {
      const out = []; const sc = window.scrollY;
      const root = page.querySelector(`.fin-part[data-side="${node.side}"]`);
      const inside = (el) => unit.contains(el);
      const top = (el) => el.getBoundingClientRect().top + sc;
      const bottom = (el) => el.getBoundingClientRect().bottom + sc;
      const pid = (el) => (el.dataset.parent === '' ? null : Number(el.dataset.parent));
      const firstItem = (id) => { const c = childrenOf(node.side, id).find((x) => x.type === 'item'); return c ? c.id : null; };
      if (node.type === 'item') {
        root.querySelectorAll('.fin-item').forEach((el) => { if (!inside(el)) out.push({ parent: pid(el), before: Number(el.dataset.id), y: top(el) }); });
        root.querySelectorAll('.fin-empty').forEach((el) => { if (!inside(el)) out.push({ parent: pid(el), before: null, y: top(el) + el.offsetHeight / 2 }); });
        root.querySelectorAll('.fin-sec:not(.collapsed) .fin-shead, .fin-div .fin-dhead').forEach((el) => {
          const own = el.closest('.fin-sec, .fin-div'); if (inside(own) && own !== unit) return;
          const id = Number(own.dataset.id); if (own === unit) return;
          out.push({ parent: id, before: firstItem(id), y: bottom(el) });
        });
      } else if (node.type === 'divider') {
        root.querySelectorAll('.fin-div').forEach((el) => { if (el !== unit) out.push({ parent: pid(el), before: Number(el.dataset.id), y: top(el) }); });
        root.querySelectorAll('.fin-sec:not(.collapsed)').forEach((el) => { out.push({ parent: Number(el.dataset.id), before: null, y: bottom(el) - 1 }); });
        const re = root.querySelector(':scope > .fin-body > .fin-empty'); if (re) out.push({ parent: null, before: null, y: top(re) + re.offsetHeight / 2 });
      } else {
        root.querySelectorAll('.fin-sec').forEach((el) => { if (el !== unit) out.push({ parent: null, before: Number(el.dataset.id), y: top(el) }); });
        const body = root.querySelector('.fin-body'); out.push({ parent: null, before: null, y: bottom(body) });
      }
      return out;
    }
    page.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', () => { if (st && st.active) onUp(); else { cancelHold(); st = null; } });
    document.addEventListener('touchmove', prevent, { passive: false });
    page.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
    page.addEventListener('click', (e) => { if (blockClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    return () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      document.removeEventListener('touchmove', prevent); cancelHold();
      document.querySelectorAll('.fin-dropline').forEach((n) => n.remove());
      document.body.classList.remove('fin-dragging');
    };
  }
  cleanups.push(drag);

  draw();
  return () => {
    cleanups.forEach((f) => f());
    document.querySelectorAll('.fin-panel').forEach((p) => p.remove());
    document.body.classList.remove('bg-fin');
  };
}
