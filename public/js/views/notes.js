// Заметки: дерево папок/заметок и редактор с файлами, аудио и отменой изменений.
import { I, NOTE_ICONS } from '../icons.js';
import { get, post, put, del, upload, fileUrl } from '../api.js';
import { esc, fmtSize, fmtTime, pad } from '../state.js';
import { h, header, toast, dialog, prompt, confirm } from '../ui.js';

const open = new Set(JSON.parse(safeGet('chronum_notes_open') || '[]'));
let selected = null;
let clipboard = null; // id вырезанной заметки
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function saveOpen() { try { localStorage.setItem('chronum_notes_open', JSON.stringify([...open])); } catch { /* ignore */ } }

export async function renderNotes() {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'заметки', icon: 'book' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  let notes = (await get('/api/notes')).notes;
  const byParent = () => { const m = new Map(); for (const n of notes) { const k = n.parent_id || 0; if (!m.has(k)) m.set(k, []); m.get(k).push(n); } for (const l of m.values()) l.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || a.position - b.position || a.id - b.id); return m; };
  const sel = () => notes.find((n) => n.id === selected) || null;

  const toolbar = h(`<div class="toolbar">
    <button data-act="folder" title="новая папка">${I.folderPlus}</button>
    <button data-act="note" title="новая заметка">${I.filePlus}</button>
    <button data-act="rename" title="переименовать">${I.pencil}</button>
    <button data-act="cut" title="вырезать">${I.scissors}</button>
    <button data-act="paste" title="вставить">${I.paste}</button>
    <button data-act="delete" title="удалить">${I.trash}</button>
  </div>`);
  page.appendChild(toolbar);
  const tree = h('<div class="tree"></div>');
  page.appendChild(tree);

  async function reload() { notes = (await get('/api/notes')).notes; if (selected && !sel()) selected = null; draw(); }

  function draw() {
    const map = byParent();
    tree.innerHTML = '';
    const s = sel();
    toolbar.querySelector('[data-act=rename]').disabled = !s;
    toolbar.querySelector('[data-act=cut]').disabled = !s;
    toolbar.querySelector('[data-act=delete]').disabled = !s;
    toolbar.querySelector('[data-act=paste]').disabled = !clipboard;
    const walk = (parent, depth) => {
      for (const n of map.get(parent) || []) {
        const kids = map.get(n.id) || [];
        const isOpen = open.has(n.id);
        const row = h(`<div class="tnode ${n.id === selected ? 'sel' : ''} ${clipboard === n.id ? 'cut' : ''}" style="padding-left:${depth * 2.7}rem">
          <span class="chev ${kids.length ? (isOpen ? 'open' : 'closed') : ''}" style="${kids.length ? '' : 'visibility:hidden'}">${I.chevron}</span>
          <span class="nicon">${I[n.icon && I[n.icon] ? n.icon : (n.kind === 'folder' ? 'folder' : 'file')]}</span>
          <span class="ttl">${esc(n.title)}</span>
          ${n.kind === 'note' && n.files_count ? `<span class="cnt">${I.paperclip.replace('<svg', '<svg style="width:1.6rem;height:1.6rem;display:inline-block;vertical-align:middle"')}${n.files_count}</span>` : ''}
          ${n.kind === 'folder' && kids.length ? `<span class="cnt">${kids.length}</span>` : ''}
        </div>`);
        row.onclick = () => {
          if (selected === n.id) {
            if (n.kind === 'note') { location.hash = `#/notes/${n.id}`; return; }
            if (open.has(n.id)) open.delete(n.id); else open.add(n.id);
          } else {
            selected = n.id;
            open.add(n.id);
          }
          saveOpen(); draw();
        };
        row.querySelector('.chev').onclick = (e) => { e.stopPropagation(); if (open.has(n.id)) open.delete(n.id); else open.add(n.id); saveOpen(); draw(); };
        tree.appendChild(row);
        if (isOpen) walk(n.id, depth + 1);
      }
    };
    walk(0, 0);
    if (!notes.length) tree.appendChild(h('<p class="p">пока пусто — создайте папку или заметку кнопками выше</p>'));
  }

  // родитель для новых элементов: выбранный узел (вкладывать можно и в папки, и в заметки)
  function targetParent() { const s = sel(); return s ? s.id : null; }

  toolbar.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const act = b.dataset.act; const s = sel();
    try {
      if (act === 'folder' || act === 'note') {
        const r = await createDialog(act);
        if (!r) return;
        const n = await post('/api/notes', { kind: act, parent_id: targetParent(), title: r.title, icon: r.icon });
        const p = targetParent(); if (p) open.add(p);
        selected = n.id; saveOpen();
        await reload();
        if (act === 'note') location.hash = `#/notes/${n.id}`;
      } else if (act === 'rename') {
        const r = await createDialog(s.kind, s);
        if (!r) return;
        await put(`/api/notes/${s.id}`, { title: r.title, icon: r.icon });
        await reload();
      } else if (act === 'cut') {
        clipboard = clipboard === s.id ? null : s.id; draw();
      } else if (act === 'paste') {
        if (!clipboard) return;
        const dest = s && s.id !== clipboard ? s.id : null;
        await put(`/api/notes/${clipboard}`, { parent_id: dest });
        if (dest) open.add(dest);
        selected = clipboard; clipboard = null; saveOpen();
        await reload();
      } else if (act === 'delete') {
        const kids = notes.filter((n) => n.parent_id === s.id).length;
        const ok = await confirm(`Удалить «${s.title}»${kids ? ` и всё внутри (${kids})` : ''}?`, 'удалить');
        if (!ok) return;
        await del(`/api/notes/${s.id}`);
        selected = null;
        await reload();
      }
    } catch (err) { toast(err.message); }
  });

  draw();
}

// диалог создания/переименования: название + значок
async function createDialog(kind, existing = null) {
  let icon = existing ? existing.icon : (kind === 'folder' ? 'folder' : 'file');
  const body = h(`<div><input class="field" placeholder="${kind === 'folder' ? 'название папки' : 'название заметки'}" value="${esc(existing ? existing.title : '')}">
    <div class="icon-pick">${NOTE_ICONS.map((ic) => `<button data-ic="${ic}" class="${ic === icon ? 'on' : ''}">${I[ic]}</button>`).join('')}</div></div>`);
  body.querySelector('.icon-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-ic]'); if (!b) return; icon = b.dataset.ic; body.querySelectorAll('[data-ic]').forEach((x) => x.classList.toggle('on', x === b)); });
  const title = await dialog({ title: existing ? 'переименовать' : (kind === 'folder' ? 'новая папка' : 'новая заметка'), body, actions: [{ label: 'готово', value: (el) => el.querySelector('input').value.trim() }] });
  if (title === null) return null;
  return { title: title || (kind === 'folder' ? 'новая папка' : 'новая заметка'), icon };
}

// ---------------- редактор ----------------
export async function renderNoteEditor(id) {
  const app = document.getElementById('app');
  const data = await get(`/api/notes/${id}`);
  const note = data.note;
  let files = data.files;
  let revisions = data.revisions;
  let dirty = false, saving = false, lastSaved = note.updated_at;
  let recorder = null, chunks = [];

  const hdr = header({ title: 'заметка', icon: 'file', left: 'close', onLeft: async () => { await flush(); location.hash = '#/notes'; }, search: false });
  app.appendChild(hdr);
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  const titleInp = h(`<input class="editor-title" value="${esc(note.title)}" placeholder="название">`);
  const ta = h('<textarea class="editor" placeholder="текст заметки…"></textarea>');
  ta.value = note.content || '';
  const status = h('<div class="status"></div>');
  const tools = h(`<div class="toolbar" style="justify-content:flex-start;gap:1.6rem">
    <button data-act="save" title="сохранить">${I.check}</button>
    <button data-act="attach" title="прикрепить файл">${I.paperclip}</button>
    <button data-act="rec" title="записать аудио">${I.mic}</button>
    <button data-act="undo" title="отменить изменения (до 30 минут)">${I.undo}</button>
  </div>`);
  const filesBox = h('<div class="note-files files-list"></div>');
  page.append(titleInp, tools, ta, status, filesBox);

  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, window.innerHeight * 0.4) + 'px'; };
  grow();
  const markDirty = () => { dirty = true; setStatus(); };
  ta.addEventListener('input', () => { grow(); markDirty(); });
  titleInp.addEventListener('input', markDirty);

  function setStatus(extra = '') {
    status.innerHTML = `<span>${dirty ? 'есть несохранённые изменения' : `сохранено ${fmtTime(lastSaved)}`}</span>${recorder ? '<span class="rec">● идёт запись</span>' : ''}${extra ? `<span>${esc(extra)}</span>` : ''}`;
  }
  async function flush() {
    if (!dirty || saving) return;
    saving = true;
    try {
      const r = await put(`/api/notes/${id}`, { title: titleInp.value.trim() || 'без названия', content: ta.value });
      lastSaved = r.updated_at || new Date().toISOString(); dirty = false;
      const d = await get(`/api/notes/${id}`); revisions = d.revisions;
    } catch (e) { toast(e.message); }
    saving = false; setStatus();
  }
  const timer = setInterval(flush, 2 * 60 * 1000);
  const onHide = () => { if (dirty) flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', onHide);

  function drawFiles() {
    filesBox.innerHTML = '';
    for (const f of files) {
      const mime = f.mime || '';
      let preview = '';
      if (mime.startsWith('image/')) preview = `<img class="preview" src="${fileUrl(f.id)}" alt="${esc(f.name)}">`;
      else if (mime.startsWith('audio/')) preview = `<audio controls preload="none" src="${fileUrl(f.id)}"></audio>`;
      const row = h(`<div><div class="file-row"><span class="fi">${I[mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'file']}</span><span class="fn">${esc(f.name)}</span><span class="fs">${fmtSize(f.size || 0)}</span><a href="${fileUrl(f.id, true)}" download="${esc(f.name)}" title="скачать" style="display:grid;place-items:center;width:3.2rem;height:3.2rem"><span class="ico" style="width:2rem;height:2rem">${I.download}</span></a><button data-act="rm" title="удалить">${I.close}</button></div>${preview}</div>`);
      row.querySelector('[data-act=rm]').onclick = async () => { if (!(await confirm(`Удалить файл «${f.name}»?`, 'удалить'))) return; try { await del(`/api/files/${f.id}`); files = files.filter((x) => x.id !== f.id); drawFiles(); } catch (e) { toast(e.message); } };
      filesBox.appendChild(row);
    }
  }
  drawFiles();
  setStatus();

  tools.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'save') { dirty = true; await flush(); toast('сохранено'); }
    else if (act === 'attach') {
      const inp = h('<input type="file" multiple hidden>'); document.body.appendChild(inp);
      inp.onchange = async () => { for (const f of inp.files) { try { files.push(await upload(f, { note_id: id })); } catch (err) { toast(`${f.name}: ${err.message}`); } } inp.remove(); drawFiles(); };
      inp.click();
    } else if (act === 'rec') {
      if (recorder) { recorder.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Запись звука недоступна в этом браузере'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
        recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunks = [];
        recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const mime = recorder.mimeType || type || 'audio/webm';
          const blob = new Blob(chunks, { type: mime });
          recorder = null; b.innerHTML = I.mic; setStatus();
          const d = new Date();
          const fname = `аудио ${d.getDate()}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}-${pad(d.getMinutes())}.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`;
          try { const f = new File([blob], fname, { type: mime }); files.push(await upload(f, { note_id: id })); drawFiles(); } catch (err) { toast(err.message); }
        };
        recorder.start(); b.innerHTML = I.stop; setStatus();
      } catch (err) { toast('Нет доступа к микрофону'); }
    } else if (act === 'undo') {
      await flush();
      if (!revisions.length) { toast('Нет версий за последние 30 минут'); return; }
      const body = h(`<div class="list" style="margin-top:0">${revisions.map((r) => `<button class="li" data-id="${r.id}"><span class="ttl grow">${fmtTime(r.created_at)}</span><span class="sub">${r.len} симв.</span></button>`).join('')}</div>`);
      const picked = await new Promise((resolve) => { body.addEventListener('click', (ev) => { const x = ev.target.closest('[data-id]'); if (x) resolve(Number(x.dataset.id)); }); dialog({ title: 'вернуть версию', body, actions: [], cancel: true }).then(() => resolve(null)); });
      if (!picked) return;
      document.querySelectorAll('.dlg-back').forEach((x) => x.remove());
      try {
        const r = await post(`/api/notes/${id}/restore`, { revision_id: picked });
        ta.value = r.content; titleInp.value = r.title; lastSaved = r.updated_at; dirty = false; grow(); setStatus(); toast('версия восстановлена');
        const d = await get(`/api/notes/${id}`); revisions = d.revisions;
      } catch (err) { toast(err.message); }
    }
  });

  return async () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('beforeunload', onHide);
    if (recorder) recorder.stop();
    await flush();
  };
}
