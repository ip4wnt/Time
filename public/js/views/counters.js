// Счётчики: список, порядок (первый показывается в календаре), помесячные суммы.
import { I } from '../icons.js';
import { get, post, put, del } from '../api.js';
import { state, esc, MONTHS_SHORT, invalidateEvents } from '../state.js';
import { h, header, toast, dialog, confirm } from '../ui.js';

export async function renderCounters() {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'счетчики', icon: 'timer' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  page.appendChild(h('<p class="p">верхний счётчик показывается на ячейках календаря, если включён режим счётчика</p>'));
  const list = h('<div class="list"></div>');
  page.appendChild(list);
  const addRow = h(`<div class="row"><button class="btn small" data-act="add">${I.plus} новый счётчик</button></div>`);
  page.appendChild(addRow);
  const statsBox = h('<div></div>');
  page.appendChild(statsBox);
  let openId = null;

  function draw() {
    list.innerHTML = '';
    state.counters.forEach((c, i) => {
      const li = h(`<div class="li ${i === 0 ? 'top' : ''}">
        <button class="grow" data-act="stats" style="text-align:left"><div class="ttl">${esc(c.name)}</div><div class="sub">${c.unit ? esc(c.unit) : 'без единиц'}${i === 0 ? ' · показывается в календаре' : ''}</div></button>
        <button class="ib" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="выше">${I.up}</button>
        <button class="ib" data-act="down" ${i === state.counters.length - 1 ? 'disabled' : ''} aria-label="ниже">${I.down}</button>
        <button class="ib" data-act="edit" aria-label="изменить">${I.pencil}</button>
        <button class="ib" data-act="del" aria-label="удалить">${I.trash}</button>
      </div>`);
      li.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        try {
          if (b.dataset.act === 'up' || b.dataset.act === 'down') {
            const j = b.dataset.act === 'up' ? i - 1 : i + 1;
            [state.counters[i], state.counters[j]] = [state.counters[j], state.counters[i]];
            await put('/api/counters/order', { ids: state.counters.map((x) => x.id) });
            invalidateEvents(); draw();
          } else if (b.dataset.act === 'edit') {
            const r = await editDialog(c); if (!r) return;
            const u = await put(`/api/counters/${c.id}`, r); Object.assign(c, u); draw();
          } else if (b.dataset.act === 'del') {
            if (!(await confirm(`Удалить счётчик «${c.name}» и все его показания?`, 'удалить'))) return;
            await del(`/api/counters/${c.id}`); state.counters = state.counters.filter((x) => x.id !== c.id); invalidateEvents(); if (openId === c.id) { openId = null; statsBox.innerHTML = ''; } draw();
          } else if (b.dataset.act === 'stats') {
            openId = c.id; await showStats(c);
          }
        } catch (err) { toast(err.message); }
      });
      list.appendChild(li);
    });
    if (!state.counters.length) list.appendChild(h('<p class="p">счётчиков пока нет. Пример: «выкурено», шт; «пробежал», км; «выпито воды», л</p>'));
  }

  async function showStats(c) {
    const s = await get(`/api/counters/${c.id}/stats`);
    statsBox.innerHTML = `<h2 class="h">${esc(c.name)}: всего <b style="color:#fff;font-weight:400">${s.total}</b> ${esc(c.unit || '')} <span class="muted">(${s.n} записей)</span></h2>
      <div class="list" style="margin-top:1rem">${s.months.map((m) => { const [y, mo] = m.ym.split('-'); return `<a class="li" href="#/month/${m.ym}"><span class="ttl grow">${MONTHS_SHORT[Number(mo) - 1]} ${y}</span><span class="sub" style="font-size:1.8rem;color:#fff">${m.total} ${esc(c.unit || '')}</span></a>`; }).join('') || '<p class="p">показаний пока нет</p>'}</div>`;
  }

  addRow.querySelector('[data-act=add]').onclick = async () => {
    const r = await editDialog(null); if (!r) return;
    try { const c = await post('/api/counters', r); state.counters.push(c); draw(); } catch (e) { toast(e.message); }
  };
  draw();
}

async function editDialog(c) {
  const body = h(`<div class="form" style="margin-top:0"><label>название<input class="field" data-f="name" value="${esc(c ? c.name : '')}" placeholder="например: выкурено"></label><label>единица<input class="field" data-f="unit" value="${esc(c ? c.unit || '' : '')}" placeholder="шт, км, л…" maxlength="20"></label></div>`);
  const r = await dialog({ title: c ? 'изменить счётчик' : 'новый счётчик', body, actions: [{ label: 'готово', value: (el) => ({ name: el.querySelector('[data-f=name]').value.trim(), unit: el.querySelector('[data-f=unit]').value.trim() }) }] });
  if (!r || !r.name) return null;
  return r;
}
