// Экран «добавить»: несколько записей разных видов на выделенные часы (или дни — для задач).
import { I, KIND_ICON, KIND_LABEL, MOOD_ICON } from '../icons.js';
import { get, post, put, del, upload, fileUrl } from '../api.js';
import {
  state, loadDay, loadMonth, ymOf, hoursLabel, hoursRange, humanDate, rangesLabel, activeActivities, activity, tag, esc, saveBatch,
  fmtSize, isLight, MOOD_COLOR, todayStr, invalidateEvents, MONTHS_SHORT, parseDate,
} from '../state.js';
import { h, header, toast, dialog, prompt, confirm } from '../ui.js';

const KIND_TITLE = { activity: 'занятие', food: 'еду', task: 'задачу', thought: 'мысль', counter: 'счётчик' };

export async function renderAdd(q) {
  const app = document.getElementById('app');
  const back = q.back ? decodeURIComponent(q.back) : (q.day ? `#/day/${q.day}` : '#/month');
  const isTaskSel = !!q.days;
  const day = q.day || (q.days ? q.days.split(',')[0] : todayStr());
  const hours = q.hours ? q.hours.split(',').map(Number).filter((n) => n >= 0 && n < 24) : [];
  const days = q.days ? q.days.split(',').filter(Boolean) : [];
  const editId = q.edit ? Number(q.edit) : null;
  let kind = q.kind || 'activity';

  // --- собираем записи
  const entries = [];
  const removed = [];
  const dayEvents = await loadDay(day);
  if (editId) {
    const ev = dayEvents.find((e) => e.id === editId) || (await loadMonth(ymOf(day))).find((e) => e.id === editId);
    if (ev) {
      kind = ev.kind;
      if (ev.kind === 'task') entries.push(fromEvent(ev));
      else { // все записи тех же часов, чтобы менять их иерархию
        const set = new Set(ev.hours);
        for (const e of dayEvents) if (e.kind !== 'task' && e.hours.some((x) => set.has(x))) entries.push(fromEvent(e));
        entries.sort((a, b) => a.position - b.position);
      }
    }
  } else if (!isTaskSel && hours.length) {
    const set = new Set(hours);
    for (const e of dayEvents) if (e.kind !== 'task' && e.hours.some((x) => set.has(x))) entries.push(fromEvent(e));
  }
  const selHours = hours.length ? hours : (entries[0]?.hours || []);
  // у записей-не-задач поле days пустое, поэтому нужен именно непустой список
  const selDays = days.length ? days : (entries[0]?.days?.length ? entries[0].days : [day]);
  // в режиме еды/мысли/счётчика сразу заводим новую запись этого вида (поверх уже существующих в этих часах)
  let focusNew = false;
  if (!entries.length || (!editId && kind !== 'activity' && kind !== 'task')) { entries.push(blank(kind)); focusNew = entries.length > 1; }

  function blank(k) {
    return { id: null, kind: k, day, hours: [...selHours], days: [...selDays], activity_id: null, tag_id: null, text: '', mood: 'neutral', kcal: null, protein: null, fat: null, carbs: null, food_calc: null, counter_id: state.counters[0]?.id || null, counter_value: null, done: false, files: [], pending: [] };
  }
  function fromEvent(e) { return { ...e, hours: e.hours || [], days: e.days || [], files: e.files || [], pending: [], text: e.text || '' }; }

  app.appendChild(header({ title: `${editId ? 'изменить' : 'добавить'} ${KIND_TITLE[editId ? entries[0].kind : kind] || ''}`, left: 'close', onLeft: () => { location.hash = back; }, search: false }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  const taskWhole = (isTaskSel || entries[0].kind === 'task') && !(selDays.length === 1 && selHours.length);
  const whenText = taskWhole
    ? daysLabel(selDays)
    : `${hoursRange(selHours)} <span class="muted">${humanDate(day)}</span>`;
  page.appendChild(h(`<div class="add-when">${whenText}</div>`));
  const list = h('<div></div>');
  page.appendChild(list);
  const bottom = h(`<div class="row"><button class="round" data-act="plus" aria-label="добавить запись">${I.plus}</button><span class="spacer"></span><button class="btn" data-act="save">сохранить</button></div><div class="kinds hidden"></div>`);
  page.appendChild(bottom);
  const kindsRow = h(`<div class="kinds hidden">${['activity', 'food', 'task', 'thought', 'counter'].map((k) => `<button class="fbtn" data-kind="${k}" title="${KIND_LABEL[k]}">${I[KIND_ICON[k]]}</button>`).join('')}<button class="fbtn off" disabled title="деньги">${I.ruble}</button></div>`);
  page.appendChild(kindsRow);
  bottom.querySelector('[data-act=plus]').onclick = () => kindsRow.classList.toggle('hidden');
  kindsRow.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (!b) return; entries.push(blank(b.dataset.kind)); kindsRow.classList.add('hidden'); draw(); list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  bottom.querySelector('[data-act=save]').onclick = save;

  function draw() {
    list.innerHTML = '';
    entries.forEach((en, i) => list.appendChild(entryEl(en, i)));
  }

  function entryEl(en, i) {
    const el = h(`<section class="entry" data-i="${i}">
      <div class="entry-head">
        <span class="kind">${I[KIND_ICON[en.kind]]} ${KIND_LABEL[en.kind]}${i === 0 && en.kind !== 'task' && entries.length > 1 ? ' · окрашивает ячейку' : ''} ${en.hours.length && en.hours.join() !== selHours.join() ? `<span class="entry-hours">${hoursRange(en.hours)}</span>` : ''}</span>
        <span class="entry-tools">
          ${entries.length > 1 ? `<button data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="выше">${I.up}</button><button data-act="down" ${i === entries.length - 1 ? 'disabled' : ''} aria-label="ниже">${I.down}</button>` : ''}
          <button data-act="attach" aria-label="прикрепить файл">${I.paperclip}</button>
          <button data-act="remove" aria-label="удалить запись">${I.trash}</button>
        </span>
      </div>
      <div class="entry-body"></div>
      <div class="files-list"></div>
    </section>`);
    const body = el.querySelector('.entry-body');
    el.querySelector('[data-act=up]')?.addEventListener('click', () => { [entries[i - 1], entries[i]] = [entries[i], entries[i - 1]]; draw(); });
    el.querySelector('[data-act=down]')?.addEventListener('click', () => { [entries[i + 1], entries[i]] = [entries[i], entries[i + 1]]; draw(); });
    el.querySelector('[data-act=remove]').onclick = async () => {
      if (en.id) { const ok = await confirm('Удалить эту запись?', 'удалить'); if (!ok) return; removed.push(en.id); }
      entries.splice(i, 1);
      if (!entries.length) entries.push(blank(kind));
      draw();
    };
    el.querySelector('[data-act=attach]').onclick = () => pickFiles(en, el);
    if (en.kind === 'activity') activityBody(en, body);
    else if (en.kind === 'food') foodBody(en, body);
    else if (en.kind === 'thought') thoughtBody(en, body);
    else if (en.kind === 'counter') counterBody(en, body);
    else if (en.kind === 'task') taskBody(en, body);
    drawFiles(en, el);
    return el;
  }

  // ---- занятие
  function activityBody(en, body) {
    const acts = activeActivities();
    const sw = h(`<div class="swatches">${acts.map((a) => `<button class="swatch ${en.activity_id === a.id ? 'on' : ''}" data-id="${a.id}" style="background:${a.color}" title="${esc(a.name)}"><span class="nm ${isLight(a.color) ? 'dk' : ''}">${esc(a.name)}</span></button>`).join('')}<button class="swatch none ${!en.activity_id ? 'on' : ''}" data-id="">не выбрано</button></div>`);
    sw.addEventListener('click', (e) => { const b = e.target.closest('.swatch'); if (!b) return; en.activity_id = b.dataset.id ? Number(b.dataset.id) : null; en.tag_id = null; activityBody(en, body); });
    body.innerHTML = '';
    body.appendChild(sw);
    if (en.activity_id) {
      const tags = state.tags.filter((t) => t.activity_id === en.activity_id);
      const tg = h(`<div class="tags">${tags.map((t) => `<button class="chip ${en.tag_id === t.id ? 'on' : ''}" data-id="${t.id}">${esc(t.name)}</button>`).join('')}<button class="chip" data-act="edit" aria-label="теги">${I.pencil}${tags.length ? '' : ' теги'}</button></div>`);
      tg.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.act === 'edit') { await tagEditor(en.activity_id); activityBody(en, body); return; }
        const id = Number(b.dataset.id); en.tag_id = en.tag_id === id ? null : id; activityBody(en, body);
      });
      body.appendChild(tg);
    }
    body.appendChild(textarea(en, 'что делали, детали…'));
  }

  async function tagEditor(activityId) {
    const a = activity(activityId);
    const bodyEl = h('<div></div>');
    const redraw = () => {
      const tags = state.tags.filter((t) => t.activity_id === activityId);
      bodyEl.innerHTML = `<div class="list" style="margin-top:0">${tags.map((t) => `<div class="li"><span class="ttl grow">${esc(t.name)}</span><button class="ib" data-act="ren" data-id="${t.id}">${I.pencil}</button><button class="ib" data-act="del" data-id="${t.id}">${I.trash}</button></div>`).join('') || '<p class="p">тегов пока нет</p>'}</div>
        <div class="row" style="margin-top:1.4rem"><input class="field" placeholder="новый тег" style="flex:1"><button class="btn small" data-act="add">добавить</button></div>`;
    };
    redraw();
    bodyEl.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.act === 'add') { const inp = bodyEl.querySelector('input'); const name = inp.value.trim(); if (!name) return; const t = await post('/api/tags', { activity_id: activityId, name }); state.tags.push(t); redraw(); }
        else if (b.dataset.act === 'ren') { const t = tag(b.dataset.id); const name = await prompt('Название тега', t.name); if (!name) return; const u = await put(`/api/tags/${t.id}`, { name }); Object.assign(t, u); redraw(); }
        else if (b.dataset.act === 'del') { const t = tag(b.dataset.id); if (!(await confirm(`Удалить тег «${t.name}»?`, 'удалить'))) return; await del(`/api/tags/${t.id}`); state.tags = state.tags.filter((x) => x.id !== t.id); redraw(); }
      } catch (err) { toast(err.message); }
    });
    await dialog({ title: `теги: ${a ? a.name : ''}`, body: bodyEl, actions: [{ label: 'готово', value: true }], cancel: false });
  }

  function textarea(en, ph, cls = '') {
    const ta = h(`<textarea class="ta ${cls}" placeholder="${ph}"></textarea>`);
    ta.value = en.text || '';
    ta.addEventListener('input', () => { en.text = ta.value; });
    return ta;
  }

  // Подсказки по ранее введённым продуктам. Смотрим на отрезок строки до курсора
  // (после последнего перевода строки или запятой) и предлагаем прошлые записи.
  function foodAutocomplete(ta) {
    const list = h('<div class="food-ac-list" hidden></div>');
    let items = [];
    let active = -1;
    let seq = 0;
    let timer = null;

    const segment = () => {
      const upto = ta.value.slice(0, ta.selectionStart);
      const start = Math.max(upto.lastIndexOf('\n'), upto.lastIndexOf(','), upto.lastIndexOf(';')) + 1;
      return { start, text: upto.slice(start) };
    };
    const hide = () => { list.hidden = true; list.innerHTML = ''; items = []; active = -1; };
    const draw = () => {
      if (!items.length) { hide(); return; }
      list.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${i === active ? 'on' : ''}">${esc(it.line)}${it.n > 1 ? `<span class="n">${it.n}</span>` : ''}</button>`).join('');
      list.hidden = false;
    };
    const pick = (i) => {
      const it = items[i];
      if (!it) return;
      const seg = segment();
      const before = ta.value.slice(0, seg.start);
      const after = ta.value.slice(ta.selectionStart);
      const pad = before && !/[\n\s]$/.test(before) ? ' ' : '';
      const ins = before ? pad + it.line : it.line;
      ta.value = before + ins + after;
      const pos = before.length + ins.length;
      ta.setSelectionRange(pos, pos);
      // Значение подставлено кодом, поэтому событие input генерируем вручную —
      // иначе en.text останется прежним.
      ta.dispatchEvent(new Event('input'));
      hide();
      ta.focus();
    };
    const query = () => {
      const q = segment().text.trim();
      if (q.length < 2) { hide(); return; }
      const my = ++seq;
      get(`/api/food/suggest?q=${encodeURIComponent(q)}`).then((r) => {
        if (my !== seq || document.activeElement !== ta) return;
        const cur = segment().text.trim().toLowerCase();
        items = (r.items || []).filter((it) => it.line.toLowerCase() !== cur);
        active = -1;
        draw();
      }).catch(() => hide());
    };

    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(query, 180); });
    ta.addEventListener('keydown', (e) => {
      if (list.hidden || !items.length) return;
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; draw(); list.children[active].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; draw(); list.children[active].scrollIntoView({ block: 'nearest' }); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) { e.preventDefault(); pick(active); }
    });
    ta.addEventListener('blur', () => setTimeout(hide, 150));
    // mousedown, а не click: textarea не должна терять фокус до вставки
    list.addEventListener('mousedown', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      e.preventDefault();
      pick(Number(b.dataset.i));
    });

    const wrap = h('<div class="food-ac"></div>');
    wrap.appendChild(ta);
    wrap.appendChild(list);
    return wrap;
  }

  // ---- еда
  function foodBody(en, body) {
    body.innerHTML = '';
    const ta = textarea(en, 'например: овсянка 60 г, банан, кофе с молоком 200 мл', 'short');
    ta.style.marginTop = '0';
    body.appendChild(foodAutocomplete(ta));
    const row = h(`<div class="row" style="margin-top:1.2rem"><button class="btn small" data-act="calc">посчитать</button><span class="muted" style="font-size:1.5rem">продукты через запятую или с новой строки</span></div>`);
    body.appendChild(row);
    const res = h('<div></div>');
    body.appendChild(res);
    const fields = h(`<div class="kcal-fields">${[['kcal', 'ккал'], ['protein', 'белки'], ['fat', 'жиры'], ['carbs', 'углев.']].map(([k, l]) => `<label>${l}<input type="number" step="any" data-k="${k}" value="${en[k] ?? ''}"></label>`).join('')}</div>`);
    fields.addEventListener('input', (e) => { const k = e.target.dataset.k; en[k] = e.target.value === '' ? null : Number(e.target.value); });
    body.appendChild(fields);
    const showCalc = (c) => {
      if (!c) { res.innerHTML = ''; return; }
      res.innerHTML = `<div class="food-result"><table><tbody>${c.items.map((it) => `<tr><td>${esc(it.product || it.input)}${it.grams ? ` <span class="note">${it.grams} г</span>` : ''}${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</td><td class="n">${it.kcal} ккал<div class="note">Б ${it.protein} · Ж ${it.fat} · У ${it.carbs}</div></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>итого</td><td class="n">${c.total.kcal} ккал<div class="note">Б ${c.total.protein} · Ж ${c.total.fat} · У ${c.total.carbs}</div></td></tr></tfoot></table>${c.unknown ? `<div class="unknown">не распознано: ${c.unknown} — допишите калории вручную или уточните продукт</div>` : ''}</div>`;
    };
    showCalc(en.food_calc);
    row.querySelector('[data-act=calc]').onclick = async () => {
      if (!en.text.trim()) { toast('Сначала напишите, что ели'); return; }
      try {
        const c = await post('/api/food/calc', { text: en.text });
        en.food_calc = c; en.kcal = c.total.kcal; en.protein = c.total.protein; en.fat = c.total.fat; en.carbs = c.total.carbs;
        showCalc(c);
        fields.querySelectorAll('input').forEach((inp) => { inp.value = en[inp.dataset.k] ?? ''; });
      } catch (e) { toast(e.message); }
    };
  }

  // ---- мысль
  function thoughtBody(en, body) {
    body.innerHTML = '';
    const ta = textarea(en, 'о чём думали, что чувствовали…', 'short'); ta.style.marginTop = '0';
    body.appendChild(ta);
    const moods = h(`<div class="moods">${['sad', 'neutral', 'happy'].map((m) => `<button class="mood ${en.mood === m ? 'on' : ''}" data-m="${m}" style="background:${MOOD_COLOR[m]}" title="${{ sad: 'грустная', neutral: 'нейтральная', happy: 'радостная' }[m]}">${I[MOOD_ICON[m]]}</button>`).join('')}</div>`);
    moods.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; en.mood = b.dataset.m; moods.querySelectorAll('.mood').forEach((x) => x.classList.toggle('on', x === b)); });
    body.appendChild(moods);
  }

  // ---- счётчик
  function counterBody(en, body) {
    body.innerHTML = '';
    if (!state.counters.length) { body.appendChild(h('<p class="p">счётчиков пока нет — <a href="#/counters" style="color:#DEDEDE;text-decoration:underline">создать</a></p>')); return; }
    const row = h(`<div class="row" style="margin-top:0"><select class="field" style="flex:1">${state.counters.map((c) => `<option value="${c.id}" ${en.counter_id === c.id ? 'selected' : ''}>${esc(c.name)}${c.unit ? ` (${esc(c.unit)})` : ''}</option>`).join('')}</select><input class="field" type="number" step="any" placeholder="значение" style="width:14rem" value="${en.counter_value ?? ''}"></div>`);
    row.querySelector('select').onchange = (e) => { en.counter_id = Number(e.target.value); };
    row.querySelector('input').oninput = (e) => { en.counter_value = e.target.value === '' ? null : Number(e.target.value); };
    body.appendChild(row);
    body.appendChild(textarea(en, 'комментарий (необязательно)', 'short'));
  }

  // ---- задача
  function taskBody(en, body) {
    body.innerHTML = '';
    const ta = textarea(en, 'что нужно сделать', 'short'); ta.style.marginTop = '0';
    body.appendChild(ta);
    const acts = activeActivities();
    const sw = h(`<div class="tags"><span class="muted" style="font-size:1.5rem;margin-right:.6rem">цвет:</span>${acts.map((a) => `<button class="chip ${en.activity_id === a.id ? 'on' : ''}" data-id="${a.id}"><i class="mood-dot" style="background:${a.color};margin-right:0"></i>${esc(a.name)}</button>`).join('')}</div>`);
    sw.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; const id = Number(b.dataset.id); en.activity_id = en.activity_id === id ? null : id; sw.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', Number(x.dataset.id) === en.activity_id)); });
    body.appendChild(sw);
    const dn = h(`<label class="inline" style="margin-top:1.6rem"><input type="checkbox" class="check" ${en.done ? 'checked' : ''}> сделано</label>`);
    dn.querySelector('input').onchange = (e) => { en.done = e.target.checked; };
    body.appendChild(dn);
  }

  // ---- файлы
  function pickFiles(en, el) {
    const inp = h('<input type="file" multiple hidden>');
    document.body.appendChild(inp);
    inp.onchange = async () => {
      for (const f of inp.files) {
        try {
          const saved = await upload(f, en.id ? { event_id: en.id } : {});
          en.files.push(saved);
          if (!en.id) en.pending.push(saved.id);
        } catch (e) { toast(`${f.name}: ${e.message}`); }
      }
      inp.remove();
      drawFiles(en, el);
    };
    inp.click();
  }
  function drawFiles(en, el) {
    const box = el.querySelector('.files-list');
    box.innerHTML = '';
    for (const f of en.files) {
      const isImg = (f.mime || '').startsWith('image/');
      const row = h(`<div class="file-row">${isImg ? `<img src="${fileUrl(f.id)}" alt="">` : `<span class="fi">${I[(f.mime || '').startsWith('audio/') ? 'audio' : 'file']}</span>`}<a class="fn" href="${fileUrl(f.id, true)}" target="_blank" rel="noopener">${esc(f.name)}</a><span class="fs">${fmtSize(f.size || 0)}</span><button data-act="rm" aria-label="удалить файл">${I.close}</button></div>`);
      row.querySelector('[data-act=rm]').onclick = async () => { if (!(await confirm(`Удалить файл «${f.name}»?`, 'удалить'))) return; try { await del(`/api/files/${f.id}`); en.files = en.files.filter((x) => x.id !== f.id); en.pending = en.pending.filter((x) => x !== f.id); drawFiles(en, el); } catch (e) { toast(e.message); } };
      box.appendChild(row);
    }
  }

  // ---- сохранение
  async function save() {
    const upsert = [];
    const upsertEntries = [];
    entries.forEach((en, i) => {
      const base = { id: en.id || undefined, kind: en.kind, position: i, text: en.text, activity_id: en.activity_id, tag_id: en.tag_id, done: en.done };
      if (en.kind === 'task') {
        base.days = en.days.length ? en.days : (selDays.length ? selDays : [day]);
        // задачу, добавленную к конкретному часу, привязываем к этому часу
        if (base.days.length === 1) base.hours = en.hours.length ? en.hours : selHours;
      }
      else { base.day = en.day || day; base.hours = en.hours.length ? en.hours : selHours; }
      if (en.kind === 'thought') base.mood = en.mood;
      if (en.kind === 'food') Object.assign(base, { kcal: en.kcal, protein: en.protein, fat: en.fat, carbs: en.carbs, food_calc: en.food_calc });
      if (en.kind === 'counter') Object.assign(base, { counter_id: en.counter_id, counter_value: en.counter_value });
      // пустые новые записи не сохраняем
      const empty = !en.id && !en.text.trim() && !en.activity_id && en.kind !== 'counter' && !en.pending.length && !(en.kind === 'food' && en.kcal != null);
      if (!empty) { upsert.push(base); upsertEntries.push(en); }
    });
    if (!upsert.length && !removed.length) { location.hash = back; return; }
    const btn = bottom.querySelector('[data-act=save]'); btn.disabled = true;
    try {
      const saved = await saveBatch(upsert, removed);
      // привязываем загруженные до сохранения файлы к созданным событиям
      for (let i = 0; i < upsertEntries.length; i++) {
        const en = upsertEntries[i]; const ev = saved[i];
        if (ev && en.pending.length) for (const fid of en.pending) await put(`/api/files/${fid}`, { event_id: ev.id }).catch(() => {});
      }
      invalidateEvents();
      toast('сохранено');
      location.hash = back;
    } catch (e) { toast(e.message); btn.disabled = false; }
  }

  draw();
  if (focusNew) { const last = list.lastElementChild; last?.scrollIntoView({ block: 'start' }); last?.querySelector('textarea, input')?.focus(); }
}

function daysLabel(days) {
  const byMonth = new Map();
  for (const d of days) { const ym = d.slice(0, 7); if (!byMonth.has(ym)) byMonth.set(ym, []); byMonth.get(ym).push(Number(d.slice(8))); }
  return [...byMonth.entries()].map(([ym, ds]) => { const dt = parseDate(`${ym}-01`); return `${rangesLabel(ds)} <span class="muted">${MONTHS_SHORT[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}</span>`; }).join(', ');
}
