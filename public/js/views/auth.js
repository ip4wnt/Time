// Авторизация: имя → два вопроса (или регистрация, если имя незнакомо).
import { post, setToken } from '../api.js';
import { h } from '../ui.js';
import { esc } from '../state.js';

export function renderAuth(root) {
  return new Promise((resolve) => {
    const el = h(`<div class="auth"><div class="auth-in">
      <img class="auth-logo" src="/img/logo.png" alt="ХРОНУМ">
      <div class="auth-card"></div>
    </div></div>`);
    root.appendChild(el);
    const card = el.querySelector('.auth-card');
    let login = '';

    const done = (token) => { setToken(token); el.remove(); resolve(); };
    const showErr = (msg) => { let e = card.querySelector('.err'); if (!e) { e = h('<div class="err"></div>'); card.appendChild(e); } e.textContent = msg; };

    function stepName(prefill = '') {
      card.innerHTML = `<div class="q">Доброго дня! Как вас зовут?</div>
        <input class="field" name="login" autocomplete="username" placeholder="имя" value="${esc(prefill)}" maxlength="64">
        <button class="btn" data-act="go">Войти</button>`;
      const inp = card.querySelector('input');
      const go = async () => {
        login = inp.value.trim();
        if (!login) { showErr('Введите имя'); return; }
        try {
          const r = await post('/api/auth/start', { login });
          if (r.status === 'known') stepQuestions(r);
          else stepRegister();
        } catch (e) { showErr(e.message); }
      };
      card.querySelector('[data-act=go]').onclick = go;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      inp.focus();
    }

    function stepQuestions(r) {
      card.innerHTML = `<div class="q">${esc(r.login)}, проверим, что это вы.</div>
        <div class="qa">${r.questions.map((q) => `<div class="q" style="font-size:1.8rem">${esc(q.question)}</div><input class="field" data-qid="${q.id}" autocomplete="off" placeholder="ответ">`).join('')}</div>
        <button class="btn" data-act="go">Войти</button>
        <button class="btn small ghost" data-act="back">другое имя</button>`;
      const go = async () => {
        const answers = {};
        card.querySelectorAll('input[data-qid]').forEach((i) => { answers[i.dataset.qid] = i.value; });
        try { const res = await post('/api/auth/answer', { challenge: r.challenge, answers }); done(res.token); }
        catch (e) {
          showErr(e.message);
          if (e.status === 400) setTimeout(() => stepName(login), 1500); // challenge истёк
        }
      };
      card.querySelector('[data-act=go]').onclick = go;
      card.querySelector('[data-act=back]').onclick = () => stepName();
      card.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
      card.querySelector('input').focus();
    }

    function stepRegister() {
      card.innerHTML = `<div class="q">${esc(login)}, похоже, вы у нас впервые.
Скажите мне две вещи, которые будем знать только мы с вами, чтобы я узнал вас в будущем.</div>
        <div class="qa">
          <input class="field" data-f="q1" placeholder="вопрос 1" maxlength="300">
          <input class="field" data-f="a1" placeholder="ответ 1" autocomplete="off" maxlength="200">
          <input class="field" data-f="q2" placeholder="вопрос 2" maxlength="300">
          <input class="field" data-f="a2" placeholder="ответ 2" autocomplete="off" maxlength="200">
        </div>
        <div class="hint">регистр букв и лишние пробелы в ответах не важны</div>
        <button class="btn" data-act="go">Запомнить меня</button>
        <button class="btn small ghost" data-act="back">другое имя</button>`;
      const val = (f) => card.querySelector(`[data-f=${f}]`).value.trim();
      const go = async () => {
        const questions = [{ question: val('q1'), answer: val('a1') }, { question: val('q2'), answer: val('a2') }];
        if (questions.some((q) => !q.question || !q.answer)) { showErr('Заполните оба вопроса и оба ответа'); return; }
        try { const res = await post('/api/auth/register', { login, questions }); done(res.token); }
        catch (e) { showErr(e.message); }
      };
      card.querySelector('[data-act=go]').onclick = go;
      card.querySelector('[data-act=back]').onclick = () => stepName(login);
      card.querySelector('input').focus();
    }

    stepName();
  });
}
