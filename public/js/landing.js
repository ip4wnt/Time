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
     2. Счётчик времени на странице
     ====================================================================== */
  (function ticker() {
    var el = document.getElementById('ticker-time');
    if (!el) return;
    var t0 = Date.now();
    function tick() {
      var s = Math.floor((Date.now() - t0) / 1000);
      var m = Math.floor(s / 60);
      el.textContent = m > 0
        ? m + '\u00a0мин ' + String(s % 60).padStart(2, '0') + '\u00a0с'
        : s + '\u00a0с';
    }
    tick();
    setInterval(tick, 1000);
  })();

  /* ======================================================================
     3. Сетка недель жизни: 52 столбца × 80 лет
     ====================================================================== */
  var life = (function lifeGrid() {
    var cv = document.getElementById('life-canvas');
    if (!cv) return { set: function () {} };
    var ctx = cv.getContext('2d');
    var YEARS = 80, WEEKS = 52, TOTAL = YEARS * WEEKS;   // столбец — год, строка — неделя года
    var PAD_L = 26, PAD_T = 18, PAD_B = 22;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var gap, size, W, H, gridW;
    var target = 0, shown = 0, raf = 0, pulse = 0;

    function layout() {
      var avail = cv.parentNode.clientWidth;
      gap = avail < 620 ? 1 : 2;
      var maxSize = avail < 620 ? 6 : 11;
      size = Math.min((avail - PAD_L - gap * (YEARS - 1)) / YEARS, maxSize);
      gridW = YEARS * size + (YEARS - 1) * gap;
      W = PAD_L + gridW;
      H = PAD_T + WEEKS * size + (WEEKS - 1) * gap + PAD_B;
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    var EARLY = [88, 66, 200], LATE = [232, 150, 72];
    function mix(k0) {
      var k = Math.max(0, Math.min(1, k0));
      return 'rgb(' + Math.round(EARLY[0] + (LATE[0] - EARLY[0]) * k) + ',' +
        Math.round(EARLY[1] + (LATE[1] - EARLY[1]) * k) + ',' +
        Math.round(EARLY[2] + (LATE[2] - EARLY[2]) * k) + ')';
    }
    function xOf(year) { return PAD_L + year * (size + gap); }
    function yOf(week) { return PAD_T + week * (size + gap); }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      var lived = Math.round(shown);
      var cur = Math.max(6, lived / WEEKS);          // цвет тянется от рождения до «сейчас»
      for (var y = 0; y < YEARS; y++) {
        var col = mix(y / cur);
        for (var w = 0; w < WEEKS; w++) {
          var i = y * WEEKS + w;
          var x = xOf(y), yy = yOf(w);
          if (i < lived) {
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.34 + 0.62 * Math.min(1, y / cur);
            ctx.fillRect(x, yy, size, size);
            ctx.globalAlpha = 1;
          } else if (i === lived) {
            var a = 0.6 + 0.4 * Math.sin(pulse / 380);
            ctx.fillStyle = 'rgba(115,211,131,' + a.toFixed(3) + ')';
            ctx.fillRect(x - 0.5, yy - 0.5, size + 1, size + 1);
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x, yy, size, size);
          }
        }
      }

      // тонкие разделители десятилетий
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      for (var dd = 10; dd < YEARS; dd += 10) {
        ctx.fillRect(xOf(dd) - gap, PAD_T, Math.max(1, gap * 0.6), WEEKS * (size + gap) - gap);
      }

      ctx.font = '11px "Ubuntu Mono", monospace';
      // ось лет внизу
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      var axisY = PAD_T + WEEKS * (size + gap) + 6;
      for (var d = 0; d < YEARS; d += 10) {
        ctx.fillText(String(d), xOf(d), axisY);
      }
      ctx.textAlign = 'right';
      ctx.fillText('80 лет', PAD_L + gridW, axisY);
      // подписи слева
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.save();
      ctx.translate(11, PAD_T + (WEEKS * (size + gap)) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('недели года', 0, -5);
      ctx.restore();
      // метка «сейчас»
      var curYear = Math.min(YEARS - 1, Math.floor(lived / WEEKS));
      var cx = xOf(curYear) + size / 2;
      ctx.strokeStyle = 'rgba(115,211,131,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xOf(curYear) - 1.5, PAD_T - 1.5, size + 3, WEEKS * (size + gap) - gap + 3);
      ctx.strokeStyle = 'rgba(115,211,131,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, PAD_T - 8); ctx.lineTo(cx, PAD_T - 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(115,211,131,0.85)';
      ctx.textAlign = cx > PAD_L + gridW - 60 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('вы здесь', ctx.textAlign === 'right' ? cx + 4 : cx - 4, PAD_T - 7);
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
    }

    function frame(now) {
      pulse = now;
      var diff = target - shown;
      shown += Math.abs(diff) < 0.6 ? diff : diff * 0.09;
      draw();
      raf = requestAnimationFrame(frame);
    }

    layout();
    window.addEventListener('resize', function () { layout(); draw(); });

    return {
      set: function (weeks) {
        target = Math.max(0, Math.min(TOTAL, weeks));
        if (reduced) { shown = target; draw(); return; }
        if (!raf) raf = requestAnimationFrame(frame);
      },
      total: TOTAL
    };
  })();

  /* ======================================================================
     4. Расчёт по году рождения
     ====================================================================== */
  (function lifeStats() {
    var input = document.getElementById('birth');
    var range = document.getElementById('birth-range');
    if (!input || !range) return;
    var out = {
      lived: document.getElementById('st-lived'),
      left: document.getElementById('st-left'),
      days: document.getElementById('st-days'),
      share: document.getElementById('st-share')
    };
    var YEARS = 80, TOTAL = 52 * YEARS;

    function apply(year, animate) {
      var now = new Date();
      var age = now.getFullYear() - year + (now.getMonth() + now.getDate() / 31) / 12;
      if (age < 0) age = 0;
      if (age > YEARS) age = YEARS;
      var lived = Math.round(age * 52);
      var left = TOTAL - lived;
      out.lived.textContent = num(lived);
      out.left.textContent = num(left);
      out.days.textContent = num(left * 7);
      out.share.textContent = Math.round(lived / TOTAL * 100) + '\u2009%';
      life.set(animate === false ? lived : lived);
    }

    function onYear(v) {
      var year = parseInt(v, 10);
      if (isNaN(year)) return;
      year = Math.max(1930, Math.min(new Date().getFullYear(), year));
      input.value = year; range.value = year;
      apply(year);
    }

    input.addEventListener('input', function () { if (this.value.length === 4) onYear(this.value); });
    input.addEventListener('change', function () { onYear(this.value); });
    range.addEventListener('input', function () { onYear(this.value); });
    apply(parseInt(input.value, 10));
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

})();
