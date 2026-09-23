// Если сессия уже есть (токен хранится в localStorage, когда cookie недоступны),
// сразу открываем приложение — публичная страница нужна только гостям.
(function () {
  'use strict';
  try {
    if (localStorage.getItem('chronum_token')) {
      location.replace('/app' + location.hash);
    }
  } catch (e) { /* приватный режим — остаёмся на публичной странице */ }
})();
