// Авторизация: логин + пароль. Незнакомый логин — предложение зарегистрироваться.
import { post, setToken } from '../api.js';
import { h } from '../ui.js';
import { esc } from '../state.js';

export function renderAuth(root) {
  return new Promise((resolve) => {
    const el = h(`<div class="auth"><div class="auth-in">
      <div class="auth-title">Хронум</div>
      <div class="auth-body"></div>
    </div></div>`);
    root.appendChild(el);
    const body = el.querySelector('.auth-body');

    const done = (token) => { setToken(token); el.remove(); resolve(); };
    const showErr = (msg) => { const e = body.querySelector('.auth-err'); if (e) e.textContent = msg; };

    function stepLogin(login = '', password = '') {
      body.innerHTML = `<form class="auth-form" novalidate>
        <label for="au-login">Логин</label>
        <input id="au-login" name="login" autocomplete="username" maxlength="64" value="${esc(login)}">
        <label for="au-pass">Пароль</label>
        <input id="au-pass" name="password" type="password" autocomplete="current-password" maxlength="200" value="${esc(password)}">
        <div class="auth-act"><button class="auth-btn" type="submit">Войти</button></div>
      </form>
      <div class="auth-err"></div>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const l = form.login.value.trim();
        const p = form.password.value;
        if (!l) { showErr('Введите логин'); return; }
        if (!p) { showErr('Введите пароль'); return; }
        showErr('');
        try {
          const r = await post('/api/auth/login', { login: l, password: p });
          if (r.status === 'new') stepRegister(l, p);
          else done(r.token);
        } catch (e) { showErr(e.message); }
      });
      (login ? form.password : form.login).focus();
    }

    function stepRegister(login, password) {
      body.innerHTML = `<div class="auth-note">${esc(login)}, похоже, вы здесь впервые.
Повторите пароль, и я запомню вас.</div>
      <form class="auth-form" novalidate>
        <label for="au-login2">Логин</label>
        <input id="au-login2" name="login" autocomplete="username" maxlength="64" value="${esc(login)}">
        <label for="au-pass2">Пароль</label>
        <input id="au-pass2" name="password" type="password" autocomplete="new-password" maxlength="200" value="${esc(password)}">
        <label for="au-pass3">Ещё раз</label>
        <input id="au-pass3" name="password2" type="password" autocomplete="new-password" maxlength="200">
        <div class="auth-act"><button class="auth-btn" type="submit">Создать</button></div>
      </form>
      <div class="auth-err"></div>
      <button class="auth-link" type="button" data-act="back">другой логин</button>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const l = form.login.value.trim();
        const p = form.password.value;
        if (p.length < 6) { showErr('Пароль короче шести знаков'); return; }
        if (p !== form.password2.value) { showErr('Пароли не совпали'); return; }
        showErr('');
        try { const r = await post('/api/auth/register', { login: l, password: p }); done(r.token); }
        catch (e) { showErr(e.message); }
      });
      body.querySelector('[data-act=back]').onclick = () => stepLogin();
      form.password2.focus();
    }

    stepLogin();
  });
}
