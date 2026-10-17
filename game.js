/* Юный инвестор — чистый HTML/CSS/JS, без библиотек и внешних запросов.
   Контент (компании, новости, тексты) лежит в content.json; при ошибке загрузки
   используется запасная копия default-content.js. */
(function () {
  'use strict';

  /* ---------- утилиты ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nf(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function signed(n) { n = Math.round(n); return (n > 0 ? '+' : n < 0 ? '−' : '') + nf(n); }
  function coinWord(n) {
    n = Math.abs(Math.round(n));
    var a = n % 100, b = n % 10;
    if (a >= 11 && a <= 14) return 'монет';
    if (b === 1) return 'монета';
    if (b >= 2 && b <= 4) return 'монеты';
    return 'монет';
  }
  function coins(n) { return nf(n) + ' ' + coinWord(n); }
  function fill(tpl, map) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; });
  }
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------- канал «страница → приложение» ---------- */
  var bridge = {
    send: function (type, extra) {
      var msg = { type: type };
      if (extra) { for (var k in extra) msg[k] = extra[k]; }
      try { window.postMessage(msg, '*'); } catch (e) { /* вне приложения ничего не делаем */ }
    }
  };
  var completedSent = false; // COMPLETED_EVENT уходит один раз за открытие экрана игры

  /* ---------- звук (по умолчанию выключен, включается кнопкой) ---------- */
  var snd = { on: false, ctx: null };
  function tone(f, t0, dur, type, vol) {
    var c = snd.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.07, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function play(name) {
    if (!snd.on || !snd.ctx) return;
    try {
      if (name === 'coin') { tone(784, 0, 0.1); tone(1175, 0.07, 0.14); }
      else if (name === 'up') { tone(523, 0, 0.12); tone(659, 0.1, 0.12); tone(784, 0.2, 0.2); }
      else if (name === 'down') { tone(392, 0, 0.16, 'triangle'); tone(311, 0.14, 0.24, 'triangle'); }
      else if (name === 'news') { tone(440, 0, 0.1, 'triangle'); tone(587, 0.1, 0.16, 'triangle'); }
      else if (name === 'tap') { tone(600, 0, 0.06); }
      else if (name === 'win') { tone(523, 0, 0.12); tone(659, 0.12, 0.12); tone(784, 0.24, 0.12); tone(1046, 0.36, 0.3); }
    } catch (e) { /* звук необязателен */ }
  }
  function toggleSound() {
    snd.on = !snd.on;
    if (snd.on && !snd.ctx) {
      try { snd.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { snd.ctx = null; snd.on = false; }
    }
    if (snd.on && snd.ctx && snd.ctx.state === 'suspended') { try { snd.ctx.resume(); } catch (e) {} }
    var b = $('#btnSound');
    b.textContent = snd.on ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', snd.on ? 'true' : 'false');
    b.setAttribute('aria-label', snd.on ? 'Выключить звук' : 'Включить звук');
    if (snd.on) play('tap');
  }

  /* ---------- контент ---------- */
  var C = null;            // активный контент
  var contentPromise = null;

  function validate(c) {
    try {
      if (!c || !Array.isArray(c.companies) || c.companies.length < 2) return false;
      if (!(c.startCoins > 0) || !Array.isArray(c.schedule) || !c.schedule.length) return false;
      if (!c.pools || !c.texts) return false;
      var t = c.texts;
      if (!t.owl || !t.final || !t.intro || !t.badges || !t.concepts) return false;
      var ids = {};
      c.companies.forEach(function (x) { if (!x.id || !x.name || !(x.price > 0)) throw 0; ids[x.id] = 1; });
      function chk(n) {
        if (!n || !n.title) throw 0;
        for (var k in (n.effects || {})) { if (!ids[k]) throw 0; }
      }
      Object.keys(c.pools).forEach(function (k) {
        var p = c.pools[k];
        if (!p || !Array.isArray(p.items) || !p.items.length) throw 0;
        p.items.forEach(function (it) { if (p.type === 'pair') { chk(it.first); chk(it.then); } else { chk(it); } });
      });
      c.schedule.forEach(function (e) {
        if (!e.morning) throw 0;
        ['morning', 'evening'].forEach(function (k) {
          if (!e[k]) return;
          var p = c.pools[e[k].pool];
          if (!p) throw 0;
          if (p.type === 'pair' && e[k].part !== 'first' && e[k].part !== 'then') throw 0;
        });
      });
      return true;
    } catch (e) { return false; }
  }

  function loadContent() {
    var fallback = window.__DEFAULT_CONTENT;
    return new Promise(function (resolve) {
      var done = false;
      function finish(c) { if (done) return; done = true; resolve(validate(c) ? c : fallback); }
      var timer = setTimeout(function () { finish(null); }, 2500);
      try {
        fetch('content.json', { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw 0; return r.json(); })
          .then(function (j) { clearTimeout(timer); finish(j); })
          .catch(function () { clearTimeout(timer); finish(null); });
      } catch (e) { clearTimeout(timer); finish(null); }
    });
  }

  /* ---------- состояние забега ---------- */
  var S = null;
  var view = null;

  function co(id) { for (var i = 0; i < C.companies.length; i++) { if (C.companies[i].id === id) return C.companies[i]; } return null; }
  function holdingsValue(prices) {
    var v = 0;
    C.companies.forEach(function (c) { v += (S.shares[c.id] || 0) * prices[c.id]; });
    return v;
  }
  function total() { return S.cash + holdingsValue(S.price); }
  var SI = { 'Лето': '☀️', 'Осень': '🍂', 'Зима': '❄️', 'Весна': '🌸' };
  function morn(d) { return [d.morning].concat(d.extra || []); }
  function eve(d) { return (d.evening ? [d.evening] : []).concat(d.late || []); }
  function sp(id) { return S.lvl === 2 ? Math.max(1, Math.round(S.price[id] * 0.04)) : 0; }
  function sens(c, e) { return S.lvl === 2 && c.startup ? (e < 0 ? 1.5 : 1.25) : 1; }
  function intros() { return C.texts.intro.concat(S && S.lvl === 2 ? (C.texts.intro2 || []) : []); }
  function startupNews(c, win) {
    var X = C.texts.startup[win ? 'win' : 'fail'], e = {}, n = {};
    e[c.id] = win ? 0.5 : -0.3; n[c.id] = X.note;
    return { id: 'su_' + c.id, kind: 'fact', emoji: win ? '🚀' : '🧩', source: 'Вечерний выпуск · неожиданная новость',
      title: fill(X.title, { name: c.name }), text: fill(X.text, { name: c.name }), effects: e, notes: n };
  }
  function setTime(night, cb) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches, b = document.body;
    b.classList.add('fade'); b.classList.toggle('night', night);
    setTimeout(function () { b.classList.remove('fade'); cb(); }, reduce ? 0 : 2100);
  }

  function newRun(lvl) {
    if (!C.all) C.all = C.companies;
    C.companies = C.all.filter(function (c) { return lvl === 2 || !c.startup; });
    var m = /[?&]seed=(-?\d+)/.exec(location.search);
    var seed = m ? parseInt(m[1], 10) : (Date.now() ^ Math.floor(Math.random() * 1e9));
    S = {
      rng: mulberry32(seed), cash: C.startCoins, day: 0, step: 1, lvl: lvl || 1, su: {}, season: '',
      shares: {}, daily: [C.startCoins], active: [],
      pf: {}, price: {}, hist: {}, plan: [], flow: {}, log: [], last: null
    };
    C.companies.forEach(function (c) {
      S.shares[c.id] = 0; S.pf[c.id] = c.price; S.price[c.id] = Math.round(c.price); S.hist[c.id] = [Math.round(c.price)];
    });
    buildPlan();
  }

  function buildPlan() {
    var used = {}, slots = {};
    function hasTag(it, tag) { return !tag || (it.tags || []).indexOf(tag) >= 0; }
    function allowed(it) { return S.lvl === 2 || !(it.durationDays > 1); }
    function pick(spec) {
      var pool = C.pools[spec.pool];
      if (pool.type === 'pair') {
        var key = spec.slot || spec.pool;
        if (slots[key] == null) slots[key] = Math.floor(S.rng() * pool.items.length);
        return pool.items[slots[key]][spec.part];
      }
      var items = pool.items.filter(function (it) { return !used[it.id] && hasTag(it, spec.tag) && allowed(it); });
      if (!items.length) items = pool.items.filter(function (it) { return hasTag(it, spec.tag) && allowed(it); });
      if (!items.length) items = pool.items;
      var it = items[Math.floor(S.rng() * items.length)];
      used[it.id] = 1;
      return it;
    }
    C.schedule.forEach(function (e) {
      S.plan.push({
        morning: pick(e.morning),
        evening: e.evening ? pick(e.evening) : null,
        hintEvening: !!e.hintEvening, risk: !!e.risk, concept: e.concept
      });
    });
    if (S.lvl === 2) {
      var startupDays = [2, 3, 4, 5];
      C.companies.forEach(function (c) {
        if (!c.startup) return;
        var index = Math.floor(S.rng() * startupDays.length);
        S.su[c.id] = { win: S.rng() < 0.4, day: startupDays.splice(index, 1)[0] };
      });
      S.plan.forEach(function (d, i) {
        d.late = []; d.extra = [];
        for (var id in S.su) if (S.su[id].day === i) d.late.push(startupNews(co(id), S.su[id].win));
        var need = Math.max(0, 3 - 1 - eve(d).length);
        while (need-- > 0) {
          var cand = [];
          ['good', 'mixed', 'complex'].forEach(function (k) { (C.pools[k] ? C.pools[k].items : []).forEach(function (it) { if (!used[it.id]) cand.push(it); }); });
          if (!cand.length) break;
          var it = cand[Math.floor(S.rng() * cand.length)]; used[it.id] = 1; d.extra.push(it);
        }
      });
    }
  }

  /* ---------- графика ---------- */
  function owl(cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 80 80" role="img" aria-label="Сова Финя">' +
      '<ellipse cx="16" cy="52" rx="7" ry="14" transform="rotate(-14 16 52)" fill="#4651D1"/>' +
      '<ellipse cx="64" cy="52" rx="7" ry="14" transform="rotate(14 64 52)" fill="#4651D1"/>' +
      '<path d="M17 28 L21 9 L33 22 Z" fill="#4651D1"/><path d="M63 28 L59 9 L47 22 Z" fill="#4651D1"/>' +
      '<ellipse cx="40" cy="46" rx="26" ry="28" fill="#5B67E8"/>' +
      '<ellipse cx="40" cy="56" rx="16" ry="17" fill="#DDE2FF"/>' +
      '<circle cx="30" cy="36" r="10" fill="#fff"/><circle cx="50" cy="36" r="10" fill="#fff"/>' +
      '<circle cx="31" cy="37" r="4.6" fill="#1F2A44"/><circle cx="49" cy="37" r="4.6" fill="#1F2A44"/>' +
      '<circle cx="32.6" cy="35.4" r="1.5" fill="#fff"/><circle cx="50.6" cy="35.4" r="1.5" fill="#fff"/>' +
      '<circle cx="30" cy="36" r="11.5" fill="none" stroke="#FFC83D" stroke-width="2.4"/>' +
      '<circle cx="50" cy="36" r="11.5" fill="none" stroke="#FFC83D" stroke-width="2.4"/>' +
      '<path d="M41.5 36 h-3" stroke="#FFC83D" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M36 43 L44 43 L40 50 Z" fill="#FFB300"/>' +
      '<ellipse cx="32" cy="75" rx="6" ry="3" fill="#FF9F1C"/><ellipse cx="48" cy="75" rx="6" ry="3" fill="#FF9F1C"/>' +
      '</svg>';
  }
  function spark(h, color) {
    var w = 70, hh = 20, mn = Math.min.apply(null, h), mx = Math.max.apply(null, h);
    if (mx === mn) { mx += 1; mn -= 1; }
    var pts = h.map(function (v, i) {
      var x = h.length > 1 ? 2 + i * (w - 4) / (h.length - 1) : w / 2;
      var y = hh - 2 - (v - mn) / (mx - mn) * (hh - 4);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var last = pts[pts.length - 1].split(',');
    return '<svg class="spark" viewBox="0 0 70 20" aria-hidden="true"><polyline fill="none" stroke="' + color +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + pts.join(' ') + '"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6" fill="' + color + '"/></svg>';
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2300);
  }

  function setBar(showDots) {
    var bar = $('#bar');
    $('#corner').innerHTML = (showDots && S) ? '<span>' + (SI[S.season] || '') + ' ' + esc(S.season) + '</span><span>Уровень ' + S.lvl + '</span>' : '';
    bar.classList.toggle('nodots', !showDots);
    if (!showDots || !S) { $('#dots').innerHTML = ''; return; }
    var h = '';
    for (var i = 0; i < C.schedule.length; i++) {
      h += '<i class="' + (i < S.day ? 'done' : i === S.day ? 'now' : '') + '"></i>';
    }
    $('#dots').innerHTML = h;
  }

  function show(html, showDots) {
    view.innerHTML = html;
    $('#toast').classList.remove('show');
    setBar(showDots);
    window.scrollTo(0, 0);
  }

  function animateNum(el, from, to, ms, render) {
    if (!el) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === to) { el.textContent = render(to); return; }
    var t0 = null;
    function step(ts) {
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = render(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- экраны ---------- */
  function renderStart() {
    var T = (C || window.__DEFAULT_CONTENT).texts;
    show(
      '<section class="screen start">' +
        '<div class="hero">' + owl() + '</div>' +
        '<h1>' + esc(T.title) + '</h1>' +
        '<p class="lead">' + esc(T.tagline) + '</p>' +
        '<ul class="facts"><li>⏱ Одна игра — 3–5 минут</li><li>🪙 1000 учебных монет, ничего настоящего</li>' +
        '<li>📰 Каждый день — новость, которая двигает цены</li></ul>' +
        '<div class="spacer"></div>' +
        '<button class="btn primary big" data-act="start" type="button">Играть</button>' +
      '</section>', false);
  }

  function renderLevel() {
    if (!C.texts.levels) { newRun(1); renderIntro(0); return; }
    show('<section class="screen"><h2 class="center" style="margin-top:14px">Выбери уровень</h2>' +
      C.texts.levels.map(function (l) {
        return '<button class="card lvl" data-act="level" data-v="' + l.id + '" type="button"><div class="em">' + esc(l.emoji) +
          '</div><div><b>' + esc(l.title) + '</b><span>' + esc(l.text) + '</span></div></button>';
      }).join('') + '</section>', false);
  }

  var introIndex = 0;
  function introCard(it) {
    return '<div class="em">' + esc(it.emoji) + '</div><h2>' + esc(it.title) + '</h2>' +
      '<p class="intro-short">' + esc(it.short || it.text) + '</p>' +
      '<details class="intro-more"><summary>Подробнее</summary><p>' + esc(it.detail || it.text) + '</p></details>';
  }
  function updateIntro(i, direction) {
    var L = intros(), last = i === L.length - 1, card = $('#introCard');
    introIndex = i;
    card.innerHTML = introCard(L[i]);
    card.classList.remove('slide-next', 'slide-prev');
    void card.offsetWidth;
    if (direction) card.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
    Array.prototype.forEach.call($('#introDots').children, function (dot, k) { dot.classList.toggle('on', k === i); });
    $('#introPrev').disabled = i === 0;
    $('#introArrowNext').disabled = last;
    $('#introNext').textContent = last ? 'Начинаем!' : 'Дальше';
    $('#introSkip').hidden = last;
  }
  function renderIntro(i) {
    var dots = '';
    for (var k = 0; k < intros().length; k++) dots += '<i></i>';
    show('<section class="screen intro-screen">' +
      '<div class="owl-row">' + owl() + '<div class="bubble">Привет! Я Сова Финя и подскажу, как устроены акции.</div></div>' +
      '<div class="card intro-card" id="introCard" aria-live="polite"></div>' +
      '<div class="dotsrow"><button class="arr" id="introPrev" data-act="introPrev" type="button" aria-label="Назад">‹</button>' +
      '<span id="introDots" class="intro-dots">' + dots + '</span>' +
      '<button class="arr" id="introArrowNext" data-act="introNext" type="button" aria-label="Дальше">›</button></div>' +
      '<div class="spacer"></div><button class="btn primary" id="introNext" data-act="introNext" type="button"></button>' +
      '<button class="btn ghost" id="introSkip" data-act="introSkip" type="button">Пропустить</button></section>', false);
    updateIntro(i, 0);
  }

  function renderCompanies() {
    show('<section class="screen"><div class="daytag">Перед началом</div><h2 class="center">Компании городка</h2>' +
      '<p class="center company-lead">Узнай, чем они занимаются. Новости помогут понять, как изменятся их цены.</p>' +
      '<div class="company-summary">' + C.companies.map(function (c) {
        return '<div class="summary-row"><div class="co-ic" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</div>' +
          '<div><b>' + esc(c.name) + '</b>' + (c.startup ? '<span class="startup-badge">🚀 Стартап</span>' : '') +
          '<small>' + esc(c.desc) + '</small></div><strong>' + nf(c.price) + '</strong></div>';
      }).join('') + '</div><div class="spacer"></div>' +
      '<button class="btn primary" data-act="beginGame" type="button">Начать игру</button></section>', false);
  }

  function newsCard(n, kindClass) {
    var cls = n.kind === 'rumor' ? 'rumor' : '';
    if (kindClass) cls += ' ' + kindClass;
    var mark = n.kind === 'rumor' ? '❓ ' : '✔ ';
    return '<article class="paper ' + (kindClass || '') + '">' +
      '<div class="paper-head"><span>Городская газета</span><span>Монеткин</span></div>' +
      '<div class="news-emoji">' + esc(n.emoji || '📰') + '</div>' +
      '<span class="source ' + cls + '">' + (kindClass === 'sudden' ? '' : mark) + esc(n.source || '') + '</span>' +
      '<h2>' + esc(n.title) + '</h2><p>' + esc(n.text || '') + '</p>' +
      (S.lvl === 2 && n.durationDays > 1 ? '<span class="duration">Влияет ' + n.durationDays + ' дня</span>' : '') + '</article>';
  }

  function marketAdvice(hint) {
    var news = morn(S.plan[S.day]), body = hint ? '<p>' + esc(hint) + '</p>' : '';
    if (news.some(function (n) { return n.kind === 'rumor'; })) body += '<p>Слух ещё не подтверждён. Проверь источник, прежде чем ему доверять.</p>';
    news.forEach(function (n) {
      if (news.length > 1) body += '<h3>' + esc(n.title) + '</h3>';
      Object.keys(n.effects || {}).forEach(function (id) {
        var c = co(id), positive = n.effects[id] > 0, note = n.notes && n.notes[id];
        if (!c || !n.effects[id]) return;
        body += '<div class="advice-effect"><b class="' + (positive ? 'up' : 'down') + '">' +
          (positive ? '▲ ' : '▼ ') + esc(c.name) + '</b><span>' + esc(note || (positive ? 'Спрос может вырасти.' : 'Спрос может упасть.')) + '</span></div>';
      });
    });
    return '<details class="owl-help"><summary>' + owl('') + '<span>Нужна подсказка? Нажми на Сову</span><i>▾</i></summary>' +
      '<div class="owl-help-body">' + body + '</div></details>';
  }

  function renderNews() {
    S.phase = 'news';
    var d = S.plan[S.day];
    morn(d).forEach(function (n) { if (n.season) S.season = n.season; });
    if (!S.season) S.season = 'Лето';
    document.body.setAttribute('data-s', S.season);
    play('news');
    show(
      '<section class="screen">' +
        '<div class="daytag">День ' + (S.day + 1) + ' из ' + C.schedule.length + ' · утро</div>' +
        morn(d).map(function (n) { return newsCard(n); }).join('') +
        '<div class="spacer"></div>' +
        '<button class="btn primary" data-act="toMarket" type="button">К торгам</button>' +
      '</section>', true);
  }

  function cardHTML(c) {
    var p = S.price[c.id], h = S.hist[c.id], prev = h.length > 1 ? h[h.length - 2] : null;
    var own = S.shares[c.id] || 0;
    var chg = '', cls = 'flat';
    if (prev != null) {
      var pc = Math.round((p - prev) / prev * 100);
      cls = pc > 0 ? 'up' : pc < 0 ? 'down' : 'flat';
      chg = (pc > 0 ? '▲ +' : pc < 0 ? '▼ −' : '● ') + Math.abs(pc) + '%';
    }
    var color = h[h.length - 1] >= h[0] ? '#0E9F6E' : '#E5484D';
    return '<div class="co" data-co="' + esc(c.id) + '">' +
      '<div class="co-ic" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</div>' +
      '<div class="co-main"><b>' + esc(c.name) + '</b>' + (c.startup ? '<span class="startup-badge">🚀 Стартап</span>' : '') +
      '<span class="desc">' + esc(c.desc) + '</span>' + spark(h, color) + '</div>' +
      '<div class="co-px"><b>' + nf(p) + '</b><span class="chg ' + cls + '">' + (chg || 'цена') + '</span></div>' +
      '<div class="co-own"><span>' + (own ? 'У тебя: <b>' + own + ' шт.</b>' : 'У тебя пока нет акций') + '</span>' +
      '<span>' + (own ? 'стоят ' + coins(own * p) : '') + '</span></div>' +
      '<div class="co-btns">' +
        '<button class="mini sell" data-act="sell" data-id="' + esc(c.id) + '" type="button"' + (own ? '' : ' aria-disabled="true"') + '>Продать' + (S.lvl === 2 ? ' · ' + (p - sp(c.id)) : '') + '</button>' +
        '<button class="mini buy" data-act="buy" data-id="' + esc(c.id) + '" type="button">Купить' + (S.lvl === 2 ? ' · ' + (p + sp(c.id)) : '') + '</button>' +
      '</div></div>';
  }

  function companyList() {
    if (S.lvl !== 2) return C.companies.map(cardHTML).join('');
    return '<h3 class="list-heading">Обычные компании</h3>' + C.companies.filter(function (c) { return !c.startup; }).map(cardHTML).join('') +
      '<h3 class="list-heading">🚀 Стартапы <small>цена может резко измениться</small></h3>' +
      C.companies.filter(function (c) { return c.startup; }).map(cardHTML).join('');
  }

  function statsHTML() {
    var t = total(), dl = t - C.startCoins;
    return '<div class="stat"><span>Свободные монеты</span><b><i class="coin"></i>' + nf(S.cash) + '</b></div>' +
      '<div class="stat"><span>Всего с акциями</span><b>' + nf(t) +
      (dl ? '<small class="' + (dl > 0 ? 'up' : 'down') + '">' + signed(dl) + '</small>' : '') + '</b></div>';
  }

  function renderMarket() {
    S.phase = 'market';
    S.flow = {};
    var d = S.plan[S.day], n = d.morning, hint = '';
    if (S.day === 0) hint = S.lvl === 2 ? C.texts.owl.spread : C.texts.owl.firstTrade;
    else if (d.hintEvening) hint = C.texts.owl.hintSudden;
    var steps = [1, 5, 10, 'all'];
    var chips = steps.map(function (v) {
      return '<button class="chip" data-act="step" data-v="' + v + '" aria-pressed="' + (S.step === v) + '" type="button">' + (v === 'all' ? 'Все' : v) + '</button>';
    }).join('');
    show(
      '<section class="screen market">' +
        '<div class="stats" id="stats">' + statsHTML() + '</div>' +
        '<button class="newsstrip" data-act="toggleNews" aria-expanded="false" type="button"><span class="e">' + esc(n.emoji || '📰') + '</span><b>' + esc(morn(d).map(function (x) { return x.title; }).join(' · ')) + '</b><i>▾</i></button>' +
        '<div class="newsmore" id="newsmore" hidden>' + morn(d).map(function (x) { return esc(x.text || '') + ' <small>(' + esc(x.source || '') + ')</small>'; }).join('<br>') + '</div>' +
        marketAdvice(hint) +
        '<div class="stepbar"><span>За раз, шт.:</span>' + chips + '</div>' +
        '<div class="list" id="list">' + companyList() + '</div>' +
        '<div class="dock"><button class="btn primary" data-act="endDay" type="button">Закончить день</button></div>' +
      '</section>', true);
  }

  function refreshMarket(flashId, dir) {
    $('#stats').innerHTML = statsHTML();
    $('#list').innerHTML = companyList();
    if (flashId) {
      var el = $('[data-co="' + flashId + '"]');
      if (el) el.classList.add(dir === 'buy' ? 'flash-up' : 'flash-down');
    }
  }

  function trade(id, dir) {
    var c = co(id), p = S.price[id] + (dir === 'buy' ? sp(id) : -sp(id)), own = S.shares[id] || 0, step = S.step, want, qty;
    if (dir === 'buy') {
      var afford = Math.floor(S.cash / p);
      if (afford < 1) { toast('Не хватает монет на акцию. Можно продать другие акции.'); return; }
      want = step === 'all' ? afford : step;
      qty = Math.min(want, afford);
      S.cash -= qty * p; S.shares[id] = own + qty; S.flow[id] = (S.flow[id] || 0) + qty * p;
      if (qty < want) toast('Куплено: ' + qty + ' шт. — на большее не хватило монет');
    } else {
      if (own < 1) { toast('Пока нечего продавать: акций «' + c.name + '» у тебя нет.'); return; }
      want = step === 'all' ? own : step;
      qty = Math.min(want, own);
      S.cash += qty * p; S.shares[id] = own - qty; S.flow[id] = (S.flow[id] || 0) - qty * p;
    }
    play('coin');
    refreshMarket(id, dir);
  }

  function endDay() {
    var d = S.plan[S.day], old = copy(S.price);
    var holdOld = holdingsValue(old), before = S.cash + holdOld;
    var holdVals = {};
    C.companies.forEach(function (c) { holdVals[c.id] = (S.shares[c.id] || 0) * old[c.id]; });
    // сила реакции рынка на новость слегка меняется от раза к разу
    var m1 = 0.7 + 0.6 * S.rng(), m2 = 0.7 + 0.6 * S.rng(), newsImpact = {}, activeToday = S.lvl === 2 ? S.active.slice() : [];
    function sum(list, id) { var t = 0; list.forEach(function (n) { t += (n.effects && n.effects[id]) || 0; }); return t; }
    C.companies.forEach(function (c) {
      var e1 = sum(morn(d), c.id), e2 = sum(eve(d), c.id), carry = sum(activeToday.map(function (a) { return a.news; }), c.id), e3 = 0;
      var noise = (S.rng() - 0.5) * 0.05 * (S.lvl === 2 && c.startup ? 3 : 1);
      if (S.lvl === 2 && c.startup && S.rng() < 0.09) e3 = S.rng() < 0.5 ? -0.22 : 0.26;
      newsImpact[c.id] = e1 * m1 * sens(c, e1) + e2 * m2 * sens(c, e2) + carry * sens(c, carry) + e3;
      S.pf[c.id] = Math.max(3, S.pf[c.id] * (1 + e1 * m1 * sens(c, e1)) * (1 + e2 * m2 * sens(c, e2)) * (1 + carry * sens(c, carry)) * (1 + e3) * (1 + noise));
      S.price[c.id] = Math.max(5, Math.round(S.pf[c.id]));
      S.hist[c.id].push(S.price[c.id]);
    });
    S.log.push({
      day: S.day, flow: copy(S.flow), kind: d.morning.kind, eff: d.morning.effects || {},
      holdVals: holdVals, cashFrac: before > 0 ? S.cash / before : 1, risk: d.risk
    });
    S.active = S.lvl === 2 ? activeToday.filter(function (a) { a.left--; return a.left > 0; }) : [];
    if (S.lvl === 2) morn(d).concat(eve(d)).forEach(function (n) { if (n.durationDays > 1) S.active.push({ news: n, left: n.durationDays - 1 }); });
    S.last = { before: before, after: S.cash + holdingsValue(S.price), old: old, neu: copy(S.price), d: d, owned: copy(S.shares), newsImpact: newsImpact };
    S.daily.push(S.last.after);
    S.flow = {};
    setTime(true, function () { if (eve(d).length) renderSudden(); else renderResult(); });
  }

  function renderSudden() {
    S.phase = 'sudden';
    var d = S.plan[S.day];
    play('news');
    bridge.send('VIBRATION_EVENT');
    show(
      '<section class="screen sudden-wrap">' +
        '<div class="daytag">День ' + (S.day + 1) + ' из ' + C.schedule.length + ' · вечер</div>' +
        eve(d).map(function (n) { return newsCard(n, 'sudden'); }).join('') +
        '<div class="spacer"></div>' +
        '<button class="btn primary" data-act="toResult" type="button">Посмотреть, что с ценами</button>' +
      '</section>', true);
  }

  function renderResult() {
    S.phase = 'result';
    var L = S.last, d = L.d, O = C.texts.owl;
    var delta = L.after - L.before, hadShares = false;
    C.companies.forEach(function (c) { if (L.owned[c.id] > 0) hadShares = true; });
    var msg, cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    if (!hadShares) msg = O.empty;
    else if (Math.round(delta) >= 1) msg = fill(O.gain, { n: coins(delta) });
    else if (Math.round(delta) <= -1) msg = fill(O.loss, { n: coins(delta) });
    else msg = O.flat;

    var rows = C.companies.map(function (c) {
      var o = L.old[c.id], n = L.neu[c.id], pc = Math.round((n - o) / o * 100);
      var qty = L.owned[c.id] || 0, own = qty * (n - o);
      var k = pc > 0 ? 'up' : pc < 0 ? 'down' : 'flat';
      var impact = L.newsImpact[c.id] || 0;
      var badge = impact > 0 ? '<span class="news-impact positive">Положительная</span>' :
        impact < 0 ? '<span class="news-impact negative">Отрицательная</span>' :
        '<span class="news-impact neutral">Без новости</span>';
      return {
        sort: Math.abs(impact) * 1000 + Math.abs(pc),
        html: '<div class="rrow"><div class="rrow-top"><div class="ic" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</div>' +
          '<div class="nm">' + esc(c.name) + (qty ? '<span class="mine">у тебя ' + qty + ' шт.</span>' : '') + badge + '<small>' + nf(o) + ' → ' + nf(n) + '</small></div>' +
          '<div class="pc ' + k + '">' + (pc > 0 ? '▲ +' : pc < 0 ? '▼ −' : '● ') + Math.abs(pc) + '%' +
          (qty ? '<small>' + signed(own) + ' ' + coinWord(own) + '</small>' : '') + '</div></div></div>'
      };
    }).sort(function (a, b) { return b.sort - a.sort; });

    var concept = null;
    (C.texts.concepts || []).forEach(function (x) { if (x.id === d.concept) concept = x; });
    var lastDay = S.day >= C.schedule.length - 1;
    var recap = morn(d).map(function (n) { return '📰 Утро: ' + esc(n.title); }).concat(eve(d).map(function (n) { return '🌙 Вечер: ' + esc(n.title); })).join('<br>');

    show(
      '<section class="screen">' +
        '<div class="daytag">День ' + (S.day + 1) + ' из ' + C.schedule.length + ' · итоги дня</div>' +
        '<div class="card sum"><div class="from">Было ' + nf(L.before) + '</div>' +
        '<div class="big ' + cls + '"><span id="tot">' + nf(L.before) + '</span></div>' +
        '<div class="' + cls + '" style="font-weight:800" id="dl">&nbsp;</div></div>' +
        '<div class="owl-row">' + owl() + '<div class="bubble">' + esc(msg) + '</div></div>' +
        '<div class="recap">' + recap + '</div>' +
        rows.map(function (r) { return r.html; }).join('') +
        (concept ? '<div class="concept"><div class="t">Новое слово</div><b>' + esc(concept.title) + '</b><p>' + esc(concept.text) + '</p></div>' : '') +
        '<div class="dock"><button class="btn primary" data-act="next" type="button">' + (lastDay ? 'Узнать итоги' : 'Начать новый день') + '</button></div>' +
      '</section>', true);

    animateNum($('#tot'), L.before, L.after, 800, nf);
    var dl = $('#dl');
    setTimeout(function () { if (dl) dl.textContent = (delta === 0 ? 'без изменений' : signed(delta) + ' ' + coinWord(delta)); }, 820);
    play(delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'tap');
  }

  /* ---------- итоги и наблюдаемые действия ---------- */
  function evalBadges() {
    var B = C.texts.badges, out = [];
    // 1. Корзины: в день неожиданных новостей монеты в 3+ компаниях и ни в одной > 50%
    var basket = false;
    S.log.forEach(function (g) {
      if (!g.risk) return;
      var sum = 0, cnt = 0, mx = 0;
      for (var k in g.holdVals) { var v = g.holdVals[k]; if (v > 0) { sum += v; cnt++; if (v > mx) mx = v; } }
      if (cnt >= 3 && sum > 0 && mx / sum <= 0.5) basket = true;
    });
    if (basket && B.basket) out.push(B.basket);
    // 2. Следопыт новостей: покупки в сторону тех, кому новость помогает (и продажи тех, кому мешает) — минимум в 3 днях
    var good = 0;
    S.log.forEach(function (g) {
      if (g.kind === 'rumor') return;
      var score = 0;
      for (var k in g.flow) { var e = g.eff[k] || 0; score += g.flow[k] * (e > 0 ? 1 : e < 0 ? -1 : 0); }
      if (score > 0) good++;
    });
    if (good >= 3 && B.news) out.push(B.news);
    // 3. Слух: не увеличил вложения в компанию из слуха
    var rumorOk = false, sawRumor = false;
    S.log.forEach(function (g) {
      if (g.kind !== 'rumor') return;
      sawRumor = true; rumorOk = true;
      for (var k in g.eff) { if (g.eff[k] > 0 && (g.flow[k] || 0) > 0) rumorOk = false; }
    });
    if (sawRumor && rumorOk && B.rumor) out.push(B.rumor);
    // 4. Хранитель: большая часть монет почти всегда в копилке
    var avg = 0;
    S.log.forEach(function (g) { avg += g.cashFrac; });
    avg = S.log.length ? avg / S.log.length : 0;
    if (avg >= 0.6 && B.saver) out.push(B.saver);
    return out;
  }

  function buyHold(alloc) {
    var tot = 0;
    C.companies.forEach(function (c) {
      var h = S.hist[c.id], p0 = h[0], p1 = h[h.length - 1], money = alloc[c.id] || 0, n = Math.floor(money / p0);
      tot += n * p1 + (money - n * p0);
    });
    return tot;
  }

  function portfolioChart(values) {
    var low = Math.min.apply(null, values), high = Math.max.apply(null, values), range = Math.max(1, high - low);
    var pts = values.map(function (v, i) { return [24 + i * 45, 112 - (v - low) / range * 84]; });
    var line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    return '<svg class="portfolio-chart" viewBox="0 0 320 146" role="img" aria-label="Стоимость портфеля по дням: ' +
      values.map(function (v, i) { return (i ? 'день ' + i : 'старт') + ' — ' + nf(v) + ' монет'; }).join(', ') + '">' +
      '<line x1="24" y1="112" x2="294" y2="112" stroke="#DDE2EF" stroke-width="2"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#4B55D6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      pts.map(function (p, i) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (i === pts.length - 1 ? 6 : 4) + '" fill="#4B55D6" stroke="#fff" stroke-width="2"/>' +
        '<text x="' + p[0].toFixed(1) + '" y="137" text-anchor="middle">' + (i || 'С') + '</text>'; }).join('') + '</svg>';
  }

  function renderFinal() {
    S.phase = 'final';
    var F = C.texts.final, mine = total(), pct = (mine - C.startCoins) / C.startCoins * 100;
    show('<section class="screen final-screen"><div class="final-top"><div class="em">' + (pct >= 0 ? '🎉' : '🌟') + '</div><h2>Итоги игры</h2></div>' +
      '<div class="card final-metric"><span>Общая доходность</span><strong class="' + (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat') + '">' +
      (pct > 0 ? '+' : '') + pct.toFixed(1).replace('.', ',') + '%</strong><small>' + nf(C.startCoins) + ' → ' + nf(mine) + ' монет</small>' +
      '<p>Сколько процентов ты заработал или потерял за год.</p></div>' +
      '<div class="card final-chart"><h2>Стоимость портфеля по дням</h2>' + portfolioChart(S.daily) + '</div>' +
      '<div class="card final-learn"><h2>Что ты теперь знаешь</h2><ul class="learn">' +
      F.learned.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="dock static"><button class="btn primary" data-act="replay" type="button">Закончить</button></div></section>', false);
    play('win');
    bridge.send('VIBRATION_EVENT');
    if (!completedSent) { completedSent = true; bridge.send('COMPLETED_EVENT'); }
  }

  /* ---------- события ---------- */
  function onClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    switch (act) {
      case 'start':
        t.textContent = 'Загрузка…';
        contentPromise.then(function (c) { C = c; renderLevel(); });
        break;
      case 'introNext': {
        if (introIndex + 1 < intros().length) updateIntro(introIndex + 1, 1); else renderCompanies();
        play('tap'); break;
      }
      case 'introPrev': if (introIndex > 0) updateIntro(introIndex - 1, -1); play('tap'); break;
      case 'level': newRun(parseInt(t.getAttribute('data-v'), 10)); renderIntro(0); break;
      case 'introSkip': renderCompanies(); break;
      case 'beginGame': renderNews(); break;
      case 'toMarket': play('tap'); renderMarket(); break;
      case 'toggleNews': {
        var more = $('#newsmore'), open = more.hidden;
        more.hidden = !open; t.classList.toggle('open', open); t.setAttribute('aria-expanded', open ? 'true' : 'false');
        break;
      }
      case 'step': {
        var v = t.getAttribute('data-v'); S.step = v === 'all' ? 'all' : parseInt(v, 10);
        Array.prototype.forEach.call(view.querySelectorAll('.chip'), function (b) {
          b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false');
        });
        play('tap'); break;
      }
      case 'buy': trade(t.getAttribute('data-id'), 'buy'); break;
      case 'sell': trade(t.getAttribute('data-id'), 'sell'); break;
      case 'endDay': play('tap'); endDay(); break;
      case 'toResult': renderResult(); break;
      case 'next':
        play('tap');
        setTime(false, function () { if (S.day >= C.schedule.length - 1) renderFinal(); else { S.day++; renderNews(); } });
        break;
      case 'replay': renderLevel(); break;
    }
  }

  function boot() {
    view = $('#view');
    view.addEventListener('click', onClick);
    $('#btnClose').addEventListener('click', function () { bridge.send('FINISH_EVENT'); bridge.send('CLOSE_EVENT'); });
    $('#btnSound').addEventListener('click', toggleSound);
    contentPromise = loadContent();
    renderStart();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
