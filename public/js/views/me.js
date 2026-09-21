// Страница «профиль»: контрольные вопросы, норма калорий, сессии.
import { get, put, post, setToken } from '../api.js';
import { state, esc, kcalNorm } from '../state.js';
import { h, header, toast, confirm } from '../ui.js';

export async function renderMe() {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'профиль', icon: 'user' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  const me = await get('/api/me');

  page.appendChild(h(`<h2 class="h">${esc(me.user.login)}</h2><p class="p">с нами с ${new Date(me.user.created_at).toLocaleDateString('ru-RU')}</p>`));

  // --- контрольные вопросы
  page.appendChild(h('<h2 class="h">контрольные вопросы</h2><p class="p">чтобы сменить, введите оба вопроса и новые ответы. Ответы хранятся только в виде хэша, поэтому старые показать нельзя.</p>'));
  const qf = h(`<div class="form">
    ${[0, 1].map((i) => `<label>вопрос ${i + 1}<input class="field" data-q="${i}" value="${esc(me.questions[i]?.question || '')}" maxlength="300"></label><label>ответ ${i + 1}<input class="field" data-a="${i}" placeholder="новый ответ" autocomplete="off" maxlength="200"></label>`).join('')}
    <div class="row" style="margin-top:.6rem"><button class="btn small" data-act="saveq">сохранить вопросы</button></div></div>`);
  qf.querySelector('[data-act=saveq]').onclick = async () => {
    const questions = [0, 1].map((i) => ({ question: qf.querySelector(`[data-q="${i}"]`).value.trim(), answer: qf.querySelector(`[data-a="${i}"]`).value.trim() }));
    if (questions.some((q) => !q.question || !q.answer)) { toast('Заполните оба вопроса и оба ответа'); return; }
    try { await put('/api/me/questions', { questions }); toast('вопросы обновлены'); qf.querySelectorAll('[data-a]').forEach((i) => { i.value = ''; }); } catch (e) { toast(e.message); }
  };
  page.appendChild(qf);

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
}

function shortUA(ua = '') {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Firefox\//i.test(ua) ? 'Firefox' : /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'браузер';
  return [br, os].filter(Boolean).join(' · ') || 'неизвестное устройство';
}
