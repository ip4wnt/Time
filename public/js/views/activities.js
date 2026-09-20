// Настройки: занятия — цвет, название, порядок, архив.
import { I } from '../icons.js';
import { post, put, del } from '../api.js';
import { state, esc, invalidateEvents } from '../state.js';
import { h, header, toast, dialog, confirm } from '../ui.js';

export async function renderActivities() {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'настройки', icon: 'gear' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  page.appendChild(h('<h2 class="h" style="margin-top:0">занятия</h2>'));
  page.appendChild(h('<p class="p">цвет меняется прямо в кружке. Занятие с записями при удалении уходит в архив — его записи и цвет сохраняются</p>'));
  const list = h('<div class="list"></div>');
  page.appendChild(list);
  const addRow = h(`<div class="row"><button class="btn small" data-act="add">${I.plus} новое занятие</button></div>`);
  page.appendChild(addRow);
  const archBox = h('<div></div>');
  page.appendChild(archBox);

  function draw() {
    list.innerHTML = '';
    const active = state.activities.filter((a) => !a.archived);
    active.forEach((a, i) => {
      const li = h(`<div class="li">
        <input type="color" value="${a.color}" aria-label="цвет">
        <div class="grow"><div class="ttl">${esc(a.name)}</div><div class="sub">${a.is_sleep ? 'сон — не учитывается в цвете дня' : `${state.tags.filter((t) => t.activity_id === a.id).length} тегов`}</div></div>
        <button class="ib" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="выше">${I.up}</button>
        <button class="ib" data-act="down" ${i === active.length - 1 ? 'disabled' : ''} aria-label="ниже">${I.down}</button>
        <button class="ib" data-act="edit" aria-label="изменить">${I.pencil}</button>
        <button class="ib" data-act="del" aria-label="удалить">${I.trash}</button>
      </div>`);
      const color = li.querySelector('input[type=color]');
      color.addEventListener('change', async () => { try { const u = await put(`/api/activities/${a.id}`, { color: color.value }); Object.assign(a, u); invalidateEvents(); } catch (e) { toast(e.message); color.value = a.color; } });
      li.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        try {
          if (b.dataset.act === 'up' || b.dataset.act === 'down') {
            const j = b.dataset.act === 'up' ? i - 1 : i + 1;
            const ia = state.activities.indexOf(active[i]), ib = state.activities.indexOf(active[j]);
            [state.activities[ia], state.activities[ib]] = [state.activities[ib], state.activities[ia]];
            await put('/api/activities/order', { ids: state.activities.map((x) => x.id) }); draw();
          } else if (b.dataset.act === 'edit') {
            const r = await editDialog(a); if (!r) return;
            const u = await put(`/api/activities/${a.id}`, r); Object.assign(a, u); draw();
          } else if (b.dataset.act === 'del') {
            if (!(await confirm(`Удалить занятие «${a.name}»?`, 'удалить'))) return;
            const r = await del(`/api/activities/${a.id}`);
            if (r.archived) { a.archived = true; toast(`У занятия ${r.used} записей — оно перенесено в архив`); } else state.activities = state.activities.filter((x) => x.id !== a.id);
            invalidateEvents(); draw();
          }
        } catch (err) { toast(err.message); }
      });
      list.appendChild(li);
    });
    const archived = state.activities.filter((a) => a.archived);
    archBox.innerHTML = '';
    if (archived.length) {
      archBox.appendChild(h('<h2 class="h">архив</h2>'));
      const al = h('<div class="list" style="margin-top:.6rem"></div>');
      for (const a of archived) {
        const li = h(`<div class="li dim"><i class="dot" style="background:${a.color}"></i><div class="grow"><div class="ttl">${esc(a.name)}</div></div><button class="btn small ghost" data-act="restore">вернуть</button></div>`);
        li.querySelector('[data-act=restore]').onclick = async () => { try { const u = await put(`/api/activities/${a.id}`, { archived: false }); Object.assign(a, u); draw(); } catch (e) { toast(e.message); } };
        al.appendChild(li);
      }
      archBox.appendChild(al);
    }
  }
  addRow.querySelector('[data-act=add]').onclick = async () => {
    const r = await editDialog(null); if (!r) return;
    try { const a = await post('/api/activities', r); state.activities.push(a); draw(); } catch (e) { toast(e.message); }
  };
  draw();
}

async function editDialog(a) {
  const body = h(`<div class="form" style="margin-top:0"><label>название<input class="field" data-f="name" value="${esc(a ? a.name : '')}" placeholder="например: чтение"></label>
    <label>цвет<div class="row" style="margin-top:0"><input type="color" data-f="color" value="${a ? a.color : '#73D383'}"><span class="muted" data-hex>${a ? a.color : '#73D383'}</span></div></label>
    <label class="inline" style="flex-direction:row"><input type="checkbox" class="check" data-f="sleep" ${a && a.is_sleep ? 'checked' : ''}> это сон (не учитывать в цвете дня)</label></div>`);
  body.querySelector('[data-f=color]').addEventListener('input', (e) => { body.querySelector('[data-hex]').textContent = e.target.value.toUpperCase(); });
  const r = await dialog({ title: a ? 'изменить занятие' : 'новое занятие', body, actions: [{ label: 'готово', value: (el) => ({ name: el.querySelector('[data-f=name]').value.trim(), color: el.querySelector('[data-f=color]').value.toUpperCase(), is_sleep: el.querySelector('[data-f=sleep]').checked }) }] });
  if (!r || !r.name) return null;
  return r;
}
