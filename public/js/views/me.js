// Страница «профиль»: пароль, норма калорий, сессии.
import { get, put, post, setToken } from '../api.js';
import { state, esc, kcalNorm } from '../state.js';
import { h, header, toast, confirm, dialog } from '../ui.js';

export async function renderMe() {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'профиль', icon: 'user' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  const me = await get('/api/me');

  page.appendChild(h(`<h2 class="h">${esc(me.user.login)}</h2><p class="p">с нами с ${new Date(me.user.created_at).toLocaleDateString('ru-RU')}</p>`));

  // --- пароль
  page.appendChild(h('<h2 class="h">пароль</h2>'));
  page.appendChild(h('<p class="p">пароль хранится только в виде хэша, поэтому показать старый нельзя — введите его вручную.</p>'));
  const pf = h(`<div class="form">
    <label>текущий пароль<input class="field" type="password" data-p="cur" autocomplete="current-password" maxlength="200"></label>
    <label>новый пароль<input class="field" type="password" data-p="new" autocomplete="new-password" maxlength="200"></label>
    <label>новый пароль ещё раз<input class="field" type="password" data-p="new2" autocomplete="new-password" maxlength="200"></label>
    <div class="row" style="margin-top:.6rem"><button class="btn small" data-act="savep">сменить пароль</button></div></div>`);
  pf.querySelector('[data-act=savep]').onclick = async () => {
    const v = (k) => pf.querySelector(`[data-p="${k}"]`).value;
    if (v('new').length < 6) { toast('Пароль короче шести знаков'); return; }
    if (v('new') !== v('new2')) { toast('Новые пароли не совпали'); return; }
    try {
      await put('/api/me/password', { current: v('cur'), next: v('new') });
      toast('пароль изменён');
      pf.querySelectorAll('[data-p]').forEach((i) => { i.value = ''; });
    } catch (e) { toast(e.message); }
  };
  page.appendChild(pf);

  // --- настройки
  page.appendChild(h('<h2 class="h">настройки</h2>'));
  const sf = h(`<div class="form"><label>норма калорий в день<input class="field" type="number" data-f="kcal" value="${kcalNorm()}" min="500" max="10000"></label>
    <div class="row" style="margin-top:.6rem"><button class="btn small" data-act="saves">сохранить настройки</button></div></div>`);
  sf.querySelector('[data-act=saves]').onclick = async () => {
    const kcal = Number(sf.querySelector('[data-f=kcal]').value) || 2000;
    try { await put('/api/me/settings', { settings: { kcal_norm: kcal } }); state.user.settings = { ...(state.user.settings || {}), kcal_norm: kcal }; toast('сохранено'); } catch (e) { toast(e.message); }
  };
  page.appendChild(sf);

  // --- сессии и входы
  page.appendChild(h(`<h2 class="h">устройства и входы</h2>
    <div class="list">${me.sessions.map((s) => `<div class="li"><div class="grow"><div class="ttl" style="font-size:1.7rem">${esc(shortUA(s.user_agent))}</div><div class="sub">${esc(s.ip || '')} · был(а) ${new Date(s.last_seen).toLocaleString('ru-RU')}</div></div></div>`).join('')}</div>
    <p class="p" style="margin-top:1.6rem">последние попытки входа</p>
    <div class="list" style="margin-top:.6rem">${me.attempts.map((a) => `<div class="li ${a.ok ? '' : 'dim'}"><div class="grow"><div class="sub" style="font-size:1.6rem;color:${a.ok ? '#73D383' : '#ff8a80'}">${a.ok ? 'успешно' : 'неудачно'} · ${esc(a.ip || '')} · ${new Date(a.created_at).toLocaleString('ru-RU')}</div></div></div>`).join('') || '<p class="p">пока нет</p>'}</div>`));
  const lo = h('<div class="row"><button class="btn small danger" data-act="all">выйти на всех устройствах</button></div>');
  lo.querySelector('[data-act=all]').onclick = async () => {
    if (!(await confirm('Завершить все сессии, включая эту?', 'выйти'))) return;
    try { await post('/api/me/logout-all'); } catch { /* ignore */ }
    setToken(null); location.reload();
  };
  page.appendChild(lo);

  // --- удаление аккаунта
  page.appendChild(h('<h2 class="h">удаление аккаунта</h2>'));
  page.appendChild(h('<p class="p">удаляется всё: дни, занятия, заметки, файлы. сразу после подтверждения\u00a0— выход на\u00a0всех устройствах. данные лежат ещё 30\u00a0дней: войдёте за\u00a0это время\u00a0— удаление отменится, не\u00a0войдёте\u00a0— удалятся безвозвратно.</p>'));
  const df = h('<div class="row"><button class="btn small danger" data-act="del">удалить аккаунт</button></div>');
  df.querySelector('[data-act=del]').onclick = async () => {
    const ok = await dialog({
      title: 'Удалить аккаунт?',
      body: '<p class="p">все данные будут утеряны безвозвратно. вы сразу выйдете на\u00a0всех устройствах.</p>'
          + '<p class="p" style="margin-top:1rem">удаление произойдёт через 30\u00a0дней. если войдёте раньше\u00a0— удаление отменится.</p>',
      actions: [{ label: 'удалить аккаунт', value: true, cls: 'danger' }],
    });
    if (!ok) return;
    try {
      const r = await post('/api/me/delete');
      await dialog({
        title: 'Аккаунт помечен на удаление',
        body: `<p class="p">вы вышли на\u00a0всех устройствах. данные удалятся через ${r.days || 30}\u00a0дней\u00a0— чтобы отменить, просто войдите снова до\u00a0этого срока.</p>`,
        actions: [{ label: 'понятно', value: true }],
        cancel: false,
      });
      setToken(null); location.reload();
    } catch (e) { toast(e.message); }
  };
  page.appendChild(df);
}

function shortUA(ua = '') {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Firefox\//i.test(ua) ? 'Firefox' : /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'браузер';
  return [br, os].filter(Boolean).join(' · ') || 'неизвестное устройство';
}
