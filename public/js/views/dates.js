// Важные даты: список, добавление, ежегодные.
import { I } from '../icons.js';
import { post, put, del } from '../api.js';
import { state, esc, loadDates, humanDate, todayStr, parseDate, MONTHS_SHORT } from '../state.js';
import { h, header, toast, dialog, confirm } from '../ui.js';

export async function renderDates() {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'важные даты', icon: 'star' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  await loadDates(true);
  const list = h('<div class="list"></div>');
  page.appendChild(list);
  const addRow = h(`<div class="row"><button class="btn small" data-act="add">${I.plus} добавить дату</button></div>`);
  page.appendChild(addRow);

  function draw() {
    list.innerHTML = '';
    const today = todayStr();
    const items = [...state.dates].sort((a, b) => (nextOccur(a) < nextOccur(b) ? -1 : 1));
    for (const d of items) {
      const dt = parseDate(d.day);
      const label = d.yearly ? `${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]} ежегодно${d.day.slice(0, 4) !== today.slice(0, 4) ? ` (с ${dt.getFullYear()})` : ''}` : humanDate(d.day);
      const li = h(`<div class="li"><span class="ico" style="width:2.4rem;height:2.4rem;color:#fff">${I.starFill}</span><a class="grow" href="#/day/${nextOccur(d)}"><div class="ttl">${esc(d.title || 'без названия')}</div><div class="sub">${label}</div></a><button class="ib" data-act="edit" aria-label="изменить">${I.pencil}</button><button class="ib" data-act="del" aria-label="удалить">${I.trash}</button></div>`);
      li.querySelector('[data-act=edit]').onclick = async () => { const r = await editDialog(d); if (!r) return; try { const u = await put(`/api/dates/${d.id}`, r); Object.assign(d, u); draw(); } catch (e) { toast(e.message); } };
      li.querySelector('[data-act=del]').onclick = async () => { if (!(await confirm(`Удалить «${d.title}»?`, 'удалить'))) return; try { await del(`/api/dates/${d.id}`); state.dates = state.dates.filter((x) => x.id !== d.id); draw(); } catch (e) { toast(e.message); } };
      list.appendChild(li);
    }
    if (!items.length) list.appendChild(h('<p class="p">важных дат пока нет — они отмечаются звёздочкой в календаре</p>'));
  }
  addRow.querySelector('[data-act=add]').onclick = async () => {
    const r = await editDialog(null); if (!r) return;
    try { const d = await post('/api/dates', r); state.dates.push(d); draw(); } catch (e) { toast(e.message); }
  };
  draw();
}

function nextOccur(d) {
  if (!d.yearly) return d.day;
  const today = todayStr();
  const thisYear = `${today.slice(0, 4)}${d.day.slice(4)}`;
  return thisYear >= today ? thisYear : `${Number(today.slice(0, 4)) + 1}${d.day.slice(4)}`;
}

async function editDialog(d) {
  const body = h(`<div class="form" style="margin-top:0">
    <label>название<input class="field" data-f="title" value="${esc(d ? d.title : '')}" placeholder="день рождения мамы"></label>
    <label>дата<input class="field" data-f="day" type="date" value="${d ? d.day : todayStr()}"></label>
    <label class="inline" style="flex-direction:row"><input type="checkbox" class="check" data-f="yearly" ${d && d.yearly ? 'checked' : ''}> каждый год</label></div>`);
  const r = await dialog({ title: d ? 'изменить дату' : 'новая дата', body, actions: [{ label: 'готово', value: (el) => ({ title: el.querySelector('[data-f=title]').value.trim(), day: el.querySelector('[data-f=day]').value, yearly: el.querySelector('[data-f=yearly]').checked }) }] });
  if (!r || !r.day) return null;
  return r;
}
