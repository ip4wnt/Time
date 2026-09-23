/* ХРОНУМ — начальная страница: анимации без библиотек. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var num = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); };

  /* ======================================================================
     1. Герой: живая сетка часов. Клетки вспыхивают и гаснут — время идёт,
        мгновения появляются и исчезают, полоса «сейчас» ползёт вправо.
     ====================================================================== */
  (function heroGrid() {
    var cv = document.getElementById('hero-canvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0, step = 0, cols = 0, rows = 0, cells = [];
    var palette = [
      [201, 138, 78],   // тёплый — работа и дела
      [201, 138, 78],
      [96, 72, 195],    // фиолетовый — сон
      [96, 72, 195],
      [224, 127, 184],  // розовый — потраченное впустую
      [242, 217, 107],  // жёлтый — еда
      [115, 211, 131]   // зелёный — своё, попадается редко
    ];

    function layout() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      step = W < 620 ? 22 : 30;
      cols = Math.ceil(W / step) + 1;
      rows = Math.ceil(H / step) + 1;
      cells = new Array(cols * rows);
      for (var i = 0; i < cells.length; i++) cells[i] = null;
    }

    function spawn(count) {
      for (var n = 0; n < count; n++) {
        var i = (Math.random() * cells.length) | 0;
        if (cells[i]) continue;
        var c = palette[(Math.random() * palette.length) | 0];
        cells[i] = {
          c: c,
          t: 0,
          up: 400 + Math.random() * 700,       // разгорается
          hold: 600 + Math.random() * 2600,    // держится
          down: 1400 + Math.random() * 3200,   // гаснет
          peak: 0.12 + Math.random() * 0.3
        };
      }
    }

    var last = 0, sweep = -0.15, started = false;

    function frame(now) {
      if (!started) { started = true; last = now; }
      var dt = Math.min(now - last, 60); last = now;

      ctx.clearRect(0, 0, W, H);

      // холодная сетка-основа
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = 0; x <= cols; x++) { ctx.moveTo(x * step + 0.5, 0); ctx.lineTo(x * step + 0.5, H); }
      for (var y = 0; y <= rows; y++) { ctx.moveTo(0, y * step + 0.5); ctx.lineTo(W, y * step + 0.5); }
      ctx.stroke();

      // полоса «сейчас»
      sweep += dt / 26000;
      if (sweep > 1.2) sweep = -0.2;
      var sx = sweep * W;

      // живые клетки
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        if (!cell) continue;
        cell.t += dt;
        var a;
        if (cell.t < cell.up) a = cell.peak * (cell.t / cell.up);
        else if (cell.t < cell.up + cell.hold) a = cell.peak;
        else {
          var k = (cell.t - cell.up - cell.hold) / cell.down;
          if (k >= 1) { cells[i] = null; continue; }
          a = cell.peak * (1 - k) * (1 - k);
        }
        var cx = (i % cols) * step, cy = ((i / cols) | 0) * step;
        // клетки рядом с полосой «сейчас» слегка ярче
        var near = 1 + Math.max(0, 1 - Math.abs(cx + step / 2 - sx) / 140) * 0.9;
        ctx.fillStyle = 'rgba(' + cell.c[0] + ',' + cell.c[1] + ',' + cell.c[2] + ',' + (a * near).toFixed(3) + ')';
        ctx.fillRect(cx + 1, cy + 1, step - 2, step - 2);
      }

      // сама полоса
      var g = ctx.createLinearGradient(sx - 90, 0, sx + 6, 0);
      g.addColorStop(0, 'rgba(115,211,131,0)');
      g.addColorStop(1, 'rgba(115,211,131,0.18)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 90, 0, 96, H);
      ctx.fillStyle = 'rgba(115,211,131,0.5)';
      ctx.fillRect(sx, 0, 1, H);

      if (Math.random() < 0.5) spawn(1);
      raf = requestAnimationFrame(frame);
    }

    var raf = 0;
    function start() { if (!raf) { started = false; raf = requestAnimationFrame(frame); } }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    layout();
    if (reduced) {
      // без движения: один статичный кадр
      spawn(Math.round(cells.length * 0.07));
      requestAnimationFrame(function (t) { frame(t); stop(); });
    } else {
      spawn(Math.round(cells.length * 0.035));
      start();
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
      });
    }

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { layout(); spawn(Math.round(cells.length * 0.035)); }, 180);
    });
  })();

  /* ======================================================================
     2. Бегущая строка: ценность отрезка времени. Первая минута меняется
        каждые 20 секунд, дальше — на каждой минуте.
     ====================================================================== */
  (function ticker() {
    var elTime = document.getElementById('ticker-time');
    var elText = document.getElementById('ticker-text');
    if (!elTime || !elText) return;

    // at — с какой секунды показывать фразу
    var lines = [
      { at: 0,   t: 'Секунду ценит тот, кто успел затормозить. Здесь секунда\u00a0— это один тап, которым отмечен прошедший час.' },
      { at: 20,  t: 'Двадцать секунд знает спортсмен на\u00a0последнем рывке. Столько занимает записать весь ваш день.' },
      { at: 40,  t: 'Ценность минуты знает тот, кто опоздал на\u00a0самолёт. Минуты в\u00a0Хронуме складываются в\u00a0часы, которые видно.' },
      { at: 60,  t: 'Минуту ценит врач в\u00a0приёмном покое. Хронум помнит, когда вы\u00a0были у\u00a0врача в\u00a0прошлый раз и\u00a0когда пора снова.' },
      { at: 120, t: 'Две минуты\u00a0— короткий разговор с\u00a0мамой. Ровно то, что чаще всего откладывают на\u00a0потом и\u00a0забывают отметить.' },
      { at: 180, t: 'Ценность трёх минут знает тот, кто заваривает чай вместо пятой чашки кофе. Привычки тоже считаются.' },
      { at: 240, t: 'Четыре минуты\u00a0— подход в\u00a0зале. Из\u00a0таких подходов за\u00a0год собирается другое тело.' },
      { at: 300, t: 'Ценность пяти минут знает тот, кто ложится спать вовремя. Режим\u00a0— это не\u00a0сила воли, а\u00a0учёт.' },
      { at: 360, t: 'Шесть минут\u00a0— страница дневника. Через год это уже хроника, а\u00a0не\u00a0список дел.' },
      { at: 420, t: 'Семь минут\u00a0— завтрак, который вы\u00a0не\u00a0записали. Вес меняется только там, где ведётся учёт.' },
      { at: 480, t: 'Ценность восьми минут знает тот, кто читает перед сном. Хронум покажет, сколько таких вечеров у\u00a0вас было.' },
      { at: 540, t: 'Девять минут\u00a0— дорога до\u00a0дома пешком вместо пробки. Дорогу тоже можно посчитать.' },
      { at: 600, t: 'Ценность десяти минут знает отец, которого ждут во\u00a0дворе. Это время стоит отметить, чтобы оно не\u00a0потерялось.' },
      { at: 900, t: 'Четверть часа знает тот, кто пишет книгу по\u00a0абзацу в\u00a0день. Хронум считает эти абзацы за\u00a0вас.' },
      { at: 1200, t: 'Вы\u00a0здесь двадцать минут. За\u00a0это время можно было отметить целую неделю\u00a0— и\u00a0увидеть её целиком.' },
      { at: 1800, t: 'Неделя, которую вы\u00a0ещё не\u00a0записали, тоже идёт. Начать проще, чем кажется: один час, один тап.' }
    ];

    var t0 = Date.now();
    var shown = -1;

    function phrase(sec) {
      var i = 0;
      for (var k = 0; k < lines.length; k++) if (sec >= lines[k].at) i = k;
      return i;
    }

    function tick() {
      var s = Math.floor((Date.now() - t0) / 1000);
      var m = Math.floor(s / 60);
      elTime.textContent = m > 0
        ? m + '\u00a0мин ' + String(s % 60).padStart(2, '0') + '\u00a0с'
        : s + '\u00a0с';
      var i = phrase(s);
      if (i !== shown) {
        shown = i;
        if (reduced) {
          elText.textContent = lines[i].t;
        } else {
          elText.style.opacity = '0';
          setTimeout(function () {
            elText.textContent = lines[i].t;
            elText.style.opacity = '1';
          }, 260);
        }
      }
    }
    tick();
    setInterval(tick, 1000);
  })();

  /* ======================================================================
     3. Год как на ладони: 365 клеток одного прожитого года.
        Клетки заливаются волной, рядом набегают итоги.
     ====================================================================== */
  (function yearGrid() {
    var cv = document.getElementById('year-canvas');
    var list = document.getElementById('year-list');
    if (!cv || !list) return;
    var ctx = cv.getContext('2d');
    var DAYS = 365;
    var COLS = 0, size = 0, gap = 0, W = 0, H = 0;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Чем был занят год. Сумма n по всем группам — 365.
    var groups = [
      { name: 'дней с тренировкой', n: 112, color: [201, 138, 78] },
      { name: 'семейных вечеров', n: 48, color: [224, 127, 184] },
      { name: 'дней за книгой', n: 63, color: [96, 72, 195] },
      { name: 'дней в поездках', n: 21, color: [242, 217, 107] },
      { name: 'дней работы над проектом', n: 96, color: [115, 211, 131] },
      { name: 'визитов к врачу и забот о здоровье', n: 25, color: [126, 90, 140] }
    ];
    var cells = [];
    groups.forEach(function (g, gi) { for (var i = 0; i < g.n; i++) cells.push(gi); });
    // перемешиваем детерминированно, чтобы год выглядел живым, а не полосами
    var seed = 7;
    for (var i = cells.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      var j = seed % (i + 1);
      var tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp;
    }

    list.innerHTML = groups.map(function (g, gi) {
      return '<li><em style="background:rgb(' + g.color.join(',') + ')"></em>' +
        '<b data-n="' + gi + '">0</b> <span>' + g.name + '</span></li>';
    }).join('');
    var outs = Array.prototype.slice.call(list.querySelectorAll('b'));

    function layout() {
      var avail = cv.parentNode.clientWidth;
      COLS = avail < 620 ? 21 : (avail < 900 ? 26 : 31);
      gap = avail < 620 ? 2 : 3;
      var maxSize = avail < 620 ? 14 : 18;
      size = Math.min((avail - gap * (COLS - 1)) / COLS, maxSize);
      var rows = Math.ceil(DAYS / COLS);
      W = COLS * size + (COLS - 1) * gap;
      H = rows * size + (rows - 1) * gap;
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    var filled = 0, raf = 0, t0 = 0, played = false;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < DAYS; i++) {
        var x = (i % COLS) * (size + gap);
        var y = Math.floor(i / COLS) * (size + gap);
        if (i < filled) {
          var c = groups[cells[i]].color;
          ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
          ctx.globalAlpha = 0.72;
          ctx.fillRect(x, y, size, size);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(x, y, size, size);
        }
      }
      var counts = groups.map(function () { return 0; });
      for (var k = 0; k < filled; k++) counts[cells[k]]++;
      outs.forEach(function (b, gi) { b.textContent = num(counts[gi]); });
    }

    function frame(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / 2600);
      filled = Math.round(DAYS * (1 - Math.pow(1 - p, 2)));
      draw();
      if (p < 1) raf = requestAnimationFrame(frame); else raf = 0;
    }

    function play() {
      if (played) return; played = true;
      if (reduced) { filled = DAYS; draw(); return; }
      t0 = 0; raf = requestAnimationFrame(frame);
    }

    layout(); draw();
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { layout(); draw(); }, 160);
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es, obs) {
        es.forEach(function (e) { if (e.isIntersecting) { play(); obs.disconnect(); } });
      }, { threshold: 0.25 }).observe(cv);
    } else play();
  })();

  /* ======================================================================
     4. Сколько времени остаётся под цели этого года
     ====================================================================== */
  (function goalStats() {
    var input = document.getElementById('goals');
    var range = document.getElementById('goals-range');
    if (!input || !range) return;
    var out = {
      days: document.getElementById('st-days'),
      hours: document.getElementById('st-hours'),
      per: document.getElementById('st-per'),
      week: document.getElementById('st-week')
    };
    var FREE_PER_DAY = 3;

    function daysLeft() {
      var now = new Date();
      var end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      return Math.max(1, Math.ceil((end - now) / 86400000));
    }

    function update(n) {
      var goals = Math.max(1, Math.min(12, Math.round(Number(n) || 1)));
      var days = daysLeft();
      var hours = days * FREE_PER_DAY;
      out.days.textContent = num(days);
      out.hours.textContent = num(hours);
      out.per.textContent = num(hours / goals);
      out.week.textContent = (Math.round((hours / goals) / (days / 7) * 10) / 10)
        .toString().replace('.', ',');
    }

    function sync(v, from) {
      var goals = Math.max(1, Math.min(12, Math.round(Number(v) || 1)));
      if (from !== 'input') input.value = goals;
      if (from !== 'range') range.value = goals;
      update(goals);
    }

    input.addEventListener('input', function () { sync(input.value, 'input'); });
    input.addEventListener('change', function () { sync(input.value, ''); });
    range.addEventListener('input', function () { sync(range.value, 'range'); });
    sync(input.value, '');
  })();

  /* ======================================================================
     5. Разбор одного дня: 24 часа, из которых остаётся три
     ====================================================================== */
  (function dayHours() {
    var box = document.getElementById('hours');
    var legend = document.getElementById('legend');
    if (!box) return;

    var kinds = {
      sleep: { name: 'сон', color: '#3A3560' },
      work: { name: 'работа', color: '#C98A4E' },
      road: { name: 'дорога и быт', color: '#7E5A8C' },
      free: { name: 'своё время', color: '#73D383' }
    };
    var plan = [
      'sleep', 'sleep', 'sleep', 'sleep', 'sleep', 'sleep', 'sleep',  // 0–6
      'road', 'road',                                                  // 7–8
      'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', // 9–18
      'road',                                                          // 19
      'free', 'free', 'free',                                          // 20–22
      'sleep'                                                          // 23
    ];

    plan.forEach(function (kind, h) {
      var d = document.createElement('div');
      d.className = 'hour' + (kind === 'free' ? ' free' : '');
      d.dataset.kind = kind;
      d.style.background = kinds[kind].color;
      var i = document.createElement('i');
      i.textContent = h;
      d.appendChild(i);
      box.appendChild(d);
    });

    Object.keys(kinds).forEach(function (k) {
      var s = document.createElement('span');
      var em = document.createElement('em');
      em.style.background = kinds[k].color;
      s.appendChild(em);
      s.appendChild(document.createTextNode(kinds[k].name + ' \u2014 ' +
        plan.filter(function (p) { return p === k; }).length + '\u00a0ч'));
      legend.appendChild(s);
    });

    var cells = Array.prototype.slice.call(box.children);
    var played = false;
    function play() {
      if (played) return; played = true;
      if (reduced) {
        cells.forEach(function (c) {
          c.classList.add('on');
          c.classList.add(c.dataset.kind === 'free' ? 'lit' : 'dimmed');
        });
        return;
      }
      cells.forEach(function (c, i) {
        setTimeout(function () { c.classList.add('on'); }, i * 55);
      });
      setTimeout(function () {
        cells.forEach(function (c, i) {
          setTimeout(function () {
            c.classList.add(c.dataset.kind === 'free' ? 'lit' : 'dimmed');
          }, i * 22);
        });
      }, 24 * 55 + 700);
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es, obs) {
        es.forEach(function (e) { if (e.isIntersecting) { play(); obs.disconnect(); } });
      }, { threshold: 0.35 }).observe(box);
    } else play();
  })();

  /* ======================================================================
     6. Появление секций при прокрутке
     ====================================================================== */
  (function reveals() {
    var items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(items, function (el) { io.observe(el); });
  })();

  /* ======================================================================
     7. Заявка от компании: отправка без перезагрузки страницы
     ====================================================================== */
  (function leadForm() {
    var form = document.getElementById('lead-form');
    var msg = document.getElementById('lead-msg');
    if (!form || !msg) return;
    var btn = form.querySelector('button[type=submit]');

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var data = {
        name: form.name.value.trim(),
        company: form.company.value.trim(),
        contact: form.contact.value.trim(),
        telegram: form.telegram.value.trim(),
        message: form.message.value.trim()
      };
      if (data.name.length < 2) { show('Напишите, как к\u00a0вам обращаться', true); return; }
      if (!data.contact && !data.telegram) { show('Оставьте почту, телефон или ник в\u00a0телеграме', true); return; }
      if (data.message.length < 5) { show('Опишите задачу хотя бы коротко', true); return; }

      btn.disabled = true;
      show('Отправляем…', false);
      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || 'Не удалось отправить. Попробуйте позже.');
          return d;
        });
      }).then(function () {
        form.reset();
        show('Спасибо, вернёмся с\u00a0ответом', false);
      }).catch(function (e) {
        show(e.message, true);
      }).then(function () { btn.disabled = false; });
    });

    function show(text, bad) {
      msg.textContent = text;
      msg.classList.toggle('bad', !!bad);
    }
  })();

})();