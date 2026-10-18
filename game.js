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
  var SEASON_ORDER = ['Весна', 'Лето', 'Осень', 'Зима'];
  var SEASON_DAYS = 3, MAX_LONG_NEWS = 2;

  function validate(c) {
    try {
      if (!c || !Array.isArray(c.companies) || c.companies.length < 2) return false;
      if (!(c.startCoins > 0) || !Array.isArray(c.schedule) || !c.schedule.length) return false;
      if (!c.pools || !c.texts) return false;
      var t = c.texts;
      if (!t.owl || !t.final || !t.intro || !t.badges || !t.concepts) return false;
      var ids = {};
      c.companies.forEach(function (x) { if (!x.id || !x.name || !(x.price > 0)) throw 0; ids[x.id] = 1; });
      SEASON_ORDER.forEach(function (name) {
        var season = c.seasons && c.seasons[name];
        if (!season || !season.text || !season.factors || !season.notes) throw 0;
        Object.keys(season.factors).forEach(function (id) {
          if (!ids[id] || !isFinite(season.factors[id]) || !(season.factors[id] > 0)) throw 0;
        });
      });
      function chk(n) {
        if (!n || !n.title) throw 0;
        if (n.durationDays != null && (typeof n.durationDays !== 'number' || !isFinite(n.durationDays) || n.durationDays < 1 || n.durationDays % 1)) throw 0;
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
  function seasonAt(day) {
    return SEASON_ORDER[(S.startSeason + Math.floor(day / SEASON_DAYS)) % SEASON_ORDER.length];
  }
  function seasonNews(day) {
    if (S.lvl !== 2 || day % SEASON_DAYS) return null;
    var name = seasonAt(day), data = C.seasons[name], previous = day ? seasonAt(day - 1) : null;
    var effects = {}, notes = {};
    C.companies.forEach(function (c) {
      var factor = data.factors[c.id] || 1;
      var oldFactor = previous ? (C.seasons[previous].factors[c.id] || 1) : 1;
      var change = factor / oldFactor - 1;
      if (Math.abs(change) < 0.000001) return;
      effects[c.id] = change;
      notes[c.id] = name + ': ' + (data.notes[c.id] || 'Смена времени года меняет спрос на товары компании');
    });
    return { id: 'season_' + day, kind: 'season', emoji: SI[name],
      title: previous ? 'Смена сезона: ' + previous + ' → ' + name : 'Первый сезон — ' + name.toLowerCase(),
      text: data.text, hint: data.hint, effects: effects, notes: notes };
  }
  function applySeason(d) {
    if (S.lvl !== 2 || !d.seasonEvent || d.seasonApplied) return;
    var initial = S.day === 0, previous = copy(S.price);
    if (!initial) {
      d.seasonBefore = previous;
      d.seasonOwned = copy(S.shares);
    }
    d.seasonContributions = {};
    var before = total();
    C.companies.forEach(function (c) {
      var effect = d.seasonEvent.effects[c.id] || 0;
      S.pf[c.id] = Math.max(3, S.pf[c.id] * (1 + effect));
      S.price[c.id] = Math.max(5, Math.round(S.pf[c.id]));
      // Первый сезон задаёт стартовую цену, а не изменение до начала игры.
      if (initial) S.hist[c.id] = [S.price[c.id]];
      d.seasonContributions[c.id] = initial ? 0 : (S.shares[c.id] || 0) * (S.price[c.id] - previous[c.id]);
    });
    d.seasonPortfolioChange = initial ? 0 : total() - before;
    d.seasonApplied = true;
  }
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
      rng: mulberry32(seed), cash: C.startCoins, day: 0, step: 1, lvl: lvl || 1, su: {}, season: '', startSeason: 0,
      shares: {}, lots: {}, infoOpen: {}, closed: 0, profitable: 0, daily: [C.startCoins], active: [],
      pf: {}, price: {}, hist: {}, plan: [], flow: {}, log: [], last: null
    };
    S.startSeason = Math.floor(S.rng() * SEASON_ORDER.length);
    S.season = seasonAt(0);
    C.companies.forEach(function (c) {
      S.shares[c.id] = 0; S.lots[c.id] = []; S.pf[c.id] = c.price; S.price[c.id] = Math.round(c.price); S.hist[c.id] = [Math.round(c.price)];
    });
    buildPlan();
  }

  function buildPlan() {
    var used = {}, slots = {}, longCounts = [];
    for (var day = 0; day < C.schedule.length; day++) longCounts.push(0);
    function target(day) { return Math.min(3, 1 + Math.floor(day / 2)); }
    function hasTag(it, tag) { return !tag || (it.tags || []).indexOf(tag) >= 0; }
    function canPlace(it, day) {
      var season = seasonAt(day), duration = it.durationDays || 1;
      if (it.season && it.season !== season) return false;
      if (it.seasons && it.seasons.indexOf(season) < 0) return false;
      if (duration === 1) return true;
      if (S.lvl !== 2) return false;
      for (var i = day; i < Math.min(C.schedule.length, day + duration); i++) {
        if (longCounts[i] >= MAX_LONG_NEWS) return false;
      }
      return true;
    }
    function reserve(it, day) {
      used[it.id] = 1;
      if (it.durationDays > 1) {
        for (var i = day; i < Math.min(C.schedule.length, day + it.durationDays); i++) longCounts[i]++;
      }
      return it;
    }
    function choose(items, day) {
      return items.length ? reserve(items[Math.floor(S.rng() * items.length)], day) : null;
    }
    function fallback(day) {
      var items = C.pools.good ? C.pools.good.items.filter(function (it) { return canPlace(it, day); }) : [];
      return choose(items, day) || { id: 'quiet_' + day, kind: 'fact', emoji: '📰', source: 'Городская газета',
        title: 'Спокойный день в городке', text: 'Компании продолжают работать. Важных новых событий пока нет.', effects: {}, notes: {},
        hint: 'Нужно ли принимать новое решение каждый день, если ничего важного не произошло?' };
    }
    function pick(spec, day) {
      var pool = C.pools[spec.pool];
      if (pool.type === 'pair') {
        var key = spec.slot || spec.pool;
        if (slots[key] == null) slots[key] = Math.floor(S.rng() * pool.items.length);
        var paired = pool.items[slots[key]][spec.part];
        return canPlace(paired, day) ? reserve(paired, day) : fallback(day);
      }
      var items = pool.items.filter(function (it) { return !used[it.id] && hasTag(it, spec.tag) && canPlace(it, day); });
      if (!items.length) items = pool.items.filter(function (it) { return hasTag(it, spec.tag) && canPlace(it, day); });
      if (!items.length) items = pool.items.filter(function (it) { return canPlace(it, day); });
      return choose(items, day) || fallback(day);
    }
    C.schedule.forEach(function (e, day) {
      S.plan.push({
        morning: pick(e.morning, day), evening: e.evening ? pick(e.evening, day) : null,
        hintEvening: !!e.hintEvening, risk: !!e.risk, concept: e.concept,
        season: seasonAt(day), seasonEvent: seasonNews(day), extra: [], late: []
      });
    });
    if (S.lvl === 2) {
      var startupDays = [];
      S.plan.forEach(function (d, day) { if (1 + eve(d).length < target(day)) startupDays.push(day); });
      C.companies.forEach(function (c) {
        if (!c.startup || !startupDays.length) return;
        var index = Math.floor(S.rng() * startupDays.length);
        S.su[c.id] = { win: S.rng() < 0.4, day: startupDays.splice(index, 1)[0] };
      });
      S.plan.forEach(function (d, day) {
        for (var id in S.su) if (S.su[id].day === day) d.late.push(startupNews(co(id), S.su[id].win));
        var need = Math.max(0, target(day) - 1 - eve(d).length);
        while (need-- > 0) {
          var candidates = [];
          ['good', 'mixed', 'complex'].forEach(function (key) {
            (C.pools[key] ? C.pools[key].items : []).forEach(function (it) {
              if (!used[it.id] && canPlace(it, day)) candidates.push(it);
            });
          });
          d.extra.push(choose(candidates, day) || fallback(day));
        }
      });
    }
  }

  /* ---------- графика ---------- */
  function mascot(cls) {
    return '<img class="mascot' + (cls ? ' ' + esc(cls) : '') + '" src="assets/svinka1.svg" ' +
      'width="80" height="80" alt="Свинка Финя" draggable="false">';
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

  function setBar(showDots, backAction) {
    var bar = $('#bar');
    var back = $('#btnBack');
    back.hidden = !backAction;
    if (backAction) back.setAttribute('data-act', backAction); else back.removeAttribute('data-act');
    $('#corner').innerHTML = (showDots && S) ? '<span>' + (SI[S.season] || '') + ' ' + esc(S.season) + '</span><span>Уровень ' + S.lvl + '</span>' : '';
    bar.classList.toggle('nodots', !showDots);
    if (!showDots || !S) { $('#dots').innerHTML = ''; return; }
    var h = '';
    for (var i = 0; i < C.schedule.length; i++) {
      h += '<i class="' + (i < S.day ? 'done' : i === S.day ? 'now' : '') + '"></i>';
    }
    $('#dots').innerHTML = h;
  }

  function show(html, showDots, backAction) {
    view.innerHTML = html;
    $('#toast').classList.remove('show');
    setBar(showDots, backAction);
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
        '<div class="hero">' + mascot() + '</div>' +
        '<h1>' + esc(T.title) + '</h1>' +
        '<p class="lead">' + esc(T.tagline) + '</p>' +
        '<ul class="facts"><li>⏱ Одна игра — 3–5 минут</li><li>🪙 1000 учебных монет, действуй смело!</li>' +
        '<li>📰 Каждый день — новость, которая двигает цены</li></ul>' +
        '<div class="spacer"></div>' +
        '<button class="btn primary big" data-act="start" type="button">Играть</button>' +
      '</section>', false);
  }

  var selectedLevel = null;
  function renderLevel(restoreLevel) {
    selectedLevel = null;
    if (!C.texts.levels) { newRun(1); renderIntro(0); return; }
    show('<section class="screen"><h2 class="center" style="margin-top:14px">Выбери уровень</h2>' +
      C.texts.levels.map(function (l) {
        return '<button class="card lvl" data-act="level" data-v="' + l.id + '" aria-pressed="false" type="button"><div class="em">' + esc(l.emoji) +
          '</div><div><b>' + esc(l.title) + '</b><span>' + esc(l.text) + '</span></div></button>';
      }).join('') + '<div class="spacer"></div><div class="level-actions">' +
      '<button class="btn primary" data-act="beginRun" data-training="true" type="button" disabled>Пройти обучение</button>' +
      '<button class="btn secondary" data-act="beginRun" data-training="false" type="button" disabled>Играть без обучения</button>' +
      '</div></section>', false, 'backToStart');
    if (C.texts.levels.some(function (l) { return l.id === restoreLevel; })) selectLevel(restoreLevel);
  }

  function selectLevel(id) {
    selectedLevel = id;
    Array.prototype.forEach.call(view.querySelectorAll('.lvl'), function (button) {
      button.setAttribute('aria-pressed', parseInt(button.getAttribute('data-v'), 10) === id ? 'true' : 'false');
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-act="beginRun"]'), function (button) {
      button.disabled = false;
    });
    play('tap');
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
      '<div class="mascot-row">' + mascot() + '<div class="bubble">Привет! Я свинка Финя и помогу разобраться, как устроены акции.</div></div>' +
      '<div class="card intro-card" id="introCard" aria-live="polite"></div>' +
      '<div class="dotsrow"><button class="arr" id="introPrev" data-act="introPrev" type="button" aria-label="Назад">‹</button>' +
      '<span id="introDots" class="intro-dots">' + dots + '</span>' +
      '<button class="arr" id="introArrowNext" data-act="introNext" type="button" aria-label="Дальше">›</button></div>' +
      '<div class="spacer"></div><button class="btn primary" id="introNext" data-act="introNext" type="button"></button>' +
      '<button class="btn ghost" id="introSkip" data-act="introSkip" type="button">Пропустить</button></section>', false, 'introBack');
    updateIntro(i, 0);
  }

  function renderCompanies() {
    show('<section class="screen"><div class="daytag">Перед началом</div><h2 class="center">Компании городка</h2>' +
      '<p class="center company-lead">Узнай, чем занимаются компании.</p>' +
      '<div class="company-summary">' + C.companies.map(function (c) {
        return '<div class="summary-row"><div class="summary-icon" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</div>' +
          '<div class="summary-copy"><b>' + esc(c.name) + '</b>' + (c.startup ? '<span class="startup-badge">🚀 Стартап</span>' : '') +
          '<small>' + esc(c.about || c.desc) + '</small></div></div>';
      }).join('') + '</div><div class="spacer"></div>' +
      '<button class="btn primary" data-act="beginGame" type="button">Начать игру</button></section>', false, 'backToIntro');
  }

  function seasonAnnouncement(d) {
    if (!d.seasonEvent) return '';
    return '<aside class="season-announcement"><b>' + esc(d.seasonEvent.emoji) + ' ' + esc(d.seasonEvent.title) + '</b>' +
      '<p>' + esc(d.seasonEvent.text) + '</p></aside>';
  }

  function longNewsHTML(d) {
    if (S.lvl !== 2) return '';
    var active = S.active.concat(morn(d).filter(function (n) { return n.durationDays > 1; }).map(function (n) {
      return { news: n, left: n.durationDays };
    }));
    return '<section class="long-news"><h3>Долгие новости <span>' + active.length + ' / ' + MAX_LONG_NEWS + '</span></h3>' +
      (active.length ? '<ul>' + active.map(function (a) {
        var remaining = a.left === 1 ? 'Последний день влияния' : a.left === 2 ? 'Сегодня и завтра' : 'Осталось дней: ' + a.left + ', включая сегодня';
        var names = Object.keys(a.news.effects || {}).filter(function (id) { return co(id); }).map(function (id) { return esc(co(id).name); });
        return '<li><details><summary>' + esc(a.news.title) + '</summary><p>' + esc(a.news.text || '') + '</p></details>' +
          '<small>' + esc(remaining) + '</small><p class="long-news-companies">' + names.join(' · ') + '</p></li>';
      }).join('') + '</ul>' : '<p class="empty-events">Сейчас нет новостей с длительным влиянием.</p>') + '</section>';
  }

  function newsCard(n, kindClass) {
    return '<article class="paper ' + (kindClass || '') + '">' +
      '<div class="news-emoji">' + esc(n.emoji || '📰') + '</div>' +
      '<h2>' + esc(n.title) + '</h2><p>' + esc(n.text || '') + '</p>' +
      (S.lvl === 2 && n.durationDays > 1 ? '<span class="duration">Влияет ' + n.durationDays + ' дня</span>' : '') + '</article>';
  }

  function newsKindHTML(n) {
    var rumor = n.kind === 'rumor';
    return '<span class="news-kind ' + (rumor ? 'rumor' : 'official') + '">' + (rumor ? 'Слух' : 'Официально') + '</span>';
  }

  function marketNewsHTML(d) {
    var news = morn(d);
    return '<button class="newsstrip" data-act="toggleNews" aria-expanded="false" aria-controls="newsmore" type="button">' +
      '<span class="newsstrip-items">' + news.map(function (n) {
        return '<span class="newsstrip-item"><span class="e" aria-hidden="true">' + esc(n.emoji || '📰') + '</span>' +
          '<span class="newsstrip-copy">' + newsKindHTML(n) + '<b>' + esc(n.title) + '</b></span></span>';
      }).join('') + '</span><i aria-hidden="true">▾</i></button>' +
      '<div class="newsmore" id="newsmore" hidden>' + news.map(function (n) {
        return '<div class="news-detail">' + newsKindHTML(n) + '<p>' + esc(n.text || '') + '</p></div>';
      }).join('') + '</div>';
  }

  function marketAdvice() {
    if (S.lvl !== 1) return '';
    var d = S.plan[S.day], news = (d.seasonEvent ? [d.seasonEvent] : []).concat(morn(d));
    var body = news.map(function (n) {
      return '<p class="advice-note">' + esc(n.hint ||
        'Кому это событие добавит покупателей, а кому — расходов? Подумай, какие компании с ним связаны.') + '</p>';
    }).join('');
    return '<details class="mascot-help"><summary>' + mascot() + '<span>Нужна подсказка? Нажми на Финю</span><i>▾</i></summary>' +
      '<div class="mascot-help-body">' + body + '</div></details>';
  }

  function renderNews() {
    S.phase = 'news';
    var d = S.plan[S.day];
    S.season = d.season;
    applySeason(d);
    document.body.setAttribute('data-s', S.season);
    play('news');
    show(
      '<section class="screen">' +
        '<div class="daytag">День ' + (S.day + 1) + ' из ' + C.schedule.length + ' · утро</div>' +
        seasonAnnouncement(d) +
        morn(d).map(function (n) { return newsCard(n); }).join('') +
        '<div class="spacer"></div>' +
        '<button class="btn primary" data-act="toMarket" type="button">К торгам</button>' +
      '</section>', true);
  }

  function cardHTML(c) {
    var p = S.price[c.id], h = S.hist[c.id], prev = h.length > 1 ? h[h.length - 2] : null;
    var d = S.plan[S.day];
    if (d.seasonBefore && d.seasonEvent.effects[c.id]) prev = d.seasonBefore[c.id];
    if (h[h.length - 1] !== p) h = h.concat(p);
    var own = S.shares[c.id] || 0;
    var buyPrice = p + sp(c.id), sellPrice = p - sp(c.id);
    var buyCount = S.step === 'all' ? Math.floor(S.cash / buyPrice) : S.step;
    var sellCount = S.step === 'all' ? own : S.step;
    var chg = '', cls = 'flat';
    if (prev != null) {
      var pc = Math.round((p - prev) / prev * 100);
      cls = pc > 0 ? 'up' : pc < 0 ? 'down' : 'flat';
      chg = (pc > 0 ? '▲ +' : pc < 0 ? '▼ −' : '● ') + Math.abs(pc) + '%';
    }
    var color = h[h.length - 1] >= h[0] ? '#0E9F6E' : '#E5484D';
    var infoOpen = !!S.infoOpen[c.id];
    return '<div class="co' + (infoOpen ? ' info-open' : '') + '" data-co="' + esc(c.id) + '">' +
      '<div class="co-ic" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</div>' +
      '<div class="co-main"><b>' + esc(c.name) + '</b>' +
      (c.startup ? '<span class="startup-badge">🚀 Стартап</span>' : '') +
      '<span class="desc">' + esc(c.desc) + '</span>' +
      (S.day > 0 || chg ? '<div class="co-trend">' + (S.day > 0 ? spark(h, color) : '') +
        (chg ? '<span class="co-chg ' + cls + '">' + chg + '</span>' : '') + '</div>' : '') + '</div>' +
      (c.seasonInfo ? '<button class="company-info-btn" data-act="companyInfo" data-id="' + esc(c.id) +
        '" type="button" aria-label="Справка о компании «' + esc(c.name) + '»" aria-expanded="' + infoOpen +
        '" aria-controls="company-info-' + esc(c.id) + '">i</button>' : '') +
      (c.seasonInfo ? '<div class="company-info-panel" id="company-info-' + esc(c.id) + '"' +
        (infoOpen ? '' : ' hidden') + '><p>' + esc(c.seasonInfo) + '</p></div>' : '') +
      '<div class="co-own"><span>' + (own ? 'У тебя: <b>' + own + ' шт.</b>' : 'У тебя пока нет акций') + '</span>' +
      '<span>' + (own ? 'стоят ' + coins(own * p) : '') + '</span></div>' +
      '<div class="co-btns">' +
        '<button class="mini sell" data-act="sell" data-id="' + esc(c.id) + '" type="button"' + (own ? '' : ' aria-disabled="true"') + '>Продать · ' + nf(sellPrice * sellCount) + '</button>' +
        '<button class="mini buy" data-act="buy" data-id="' + esc(c.id) + '" type="button">Купить · ' + nf(buyPrice * buyCount) + '</button>' +
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
      '<div class="stat"><span>Стоимость портфеля</span><b>' + nf(t) +
      (dl ? '<small class="' + (dl > 0 ? 'up' : 'down') + '">' + signed(dl) + '</small>' : '') + '</b></div>';
  }

  function renderMarket() {
    S.phase = 'market';
    S.flow = {};
    var d = S.plan[S.day];
    var steps = [1, 5, 10, 'all'];
    var chips = steps.map(function (v) {
      return '<button class="chip" data-act="step" data-v="' + v + '" aria-pressed="' + (S.step === v) + '" type="button">' + (v === 'all' ? 'Все' : v) + '</button>';
    }).join('');
    show(
      '<section class="screen market">' +
        '<div class="stats" id="stats">' + statsHTML() + '</div>' +
        marketNewsHTML(d) +
        seasonAnnouncement(d) + longNewsHTML(d) +
        marketAdvice() +
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
      S.lots[id].push({ qty: qty, price: p });
      if (qty < want) toast('Куплено: ' + qty + ' шт. — на большее не хватило монет');
    } else {
      if (own < 1) { toast('Пока нечего продавать: акций «' + c.name + '» у тебя нет.'); return; }
      want = step === 'all' ? own : step;
      qty = Math.min(want, own);
      var left = qty, cost = 0;
      while (left > 0 && S.lots[id].length) {
        var lot = S.lots[id][0], taken = Math.min(left, lot.qty);
        cost += taken * lot.price; lot.qty -= taken; left -= taken;
        if (!lot.qty) S.lots[id].shift();
      }
      S.closed++;
      if (qty * p > cost) S.profitable++;
      S.cash += qty * p; S.shares[id] = own - qty; S.flow[id] = (S.flow[id] || 0) - qty * p;
    }
    play('coin');
    refreshMarket(id, dir);
  }

  function endDay() {
    var d = S.plan[S.day], eveningOld = copy(S.price), old = d.seasonBefore || eveningOld;
    var tradingTotal = S.cash + holdingsValue(eveningOld);
    var before = tradingTotal - (d.seasonPortfolioChange || 0);
    var holdVals = {};
    C.companies.forEach(function (c) { holdVals[c.id] = (S.shares[c.id] || 0) * eveningOld[c.id]; });
    // сила реакции рынка на новость слегка меняется от раза к разу
    var m1 = 0.7 + 0.6 * S.rng(), m2 = 0.7 + 0.6 * S.rng(), newsImpact = {}, reasons = {}, activeToday = S.lvl === 2 ? S.active.slice() : [];
    function sum(list, id) { var t = 0; list.forEach(function (n) { t += (n.effects && n.effects[id]) || 0; }); return t; }
    function recordReason(n, continuing) {
      Object.keys(n.effects || {}).forEach(function (id) {
        var effect = n.effects[id];
        if (!effect || !co(id)) return;
        if (!reasons[id]) reasons[id] = [];
        reasons[id].push({ direction: effect > 0 ? 'up' : 'down', text: (continuing ? 'Продолжается: ' : '') + ((n.notes && n.notes[id]) || n.title) });
      });
    }
    morn(d).concat(eve(d)).forEach(function (n) { recordReason(n, false); });
    activeToday.forEach(function (a) { recordReason(a.news, true); });
    if (S.day > 0 && d.seasonEvent) recordReason(d.seasonEvent, false);
    // Слабые колебания — максимум у двух компаний без влияющих на них новостей.
    var noiseMoves = {}, noiseIds = [], noiseCandidates = C.companies.filter(function (c) {
      return !reasons[c.id] && Math.floor(S.price[c.id] * 0.025) >= 1;
    });
    var noiseCount = Math.min(noiseCandidates.length, 1 + Math.floor(S.rng() * 2));
    for (var i = 0; i < noiseCount; i++) {
      var candidate = noiseCandidates.splice(Math.floor(S.rng() * noiseCandidates.length), 1)[0];
      var price = S.price[candidate.id];
      var move = Math.max(1, Math.min(Math.floor(price * 0.025), Math.round(price * (0.01 + S.rng() * 0.01))));
      noiseMoves[candidate.id] = price + (S.rng() < 0.5 ? -move : move);
    }
    C.companies.forEach(function (c) {
      var e1 = sum(morn(d), c.id), e2 = sum(eve(d), c.id), carry = sum(activeToday.map(function (a) { return a.news; }), c.id), e3 = 0;
      var seasonEffect = S.day > 0 && d.seasonEvent ? (d.seasonEvent.effects[c.id] || 0) : 0;
      if (S.lvl === 2 && c.startup && S.rng() < 0.09) {
        e3 = S.rng() < 0.5 ? -0.22 : 0.26;
        if (!reasons[c.id]) reasons[c.id] = [];
        reasons[c.id].push({ direction: e3 > 0 ? 'up' : 'down', text: e3 > 0 ?
          'Новые заказы → у стартапа больше покупателей → цена растёт' :
          'Отмена заказов → у стартапа меньше доходов → цена падает' });
      }
      newsImpact[c.id] = e1 * m1 * sens(c, e1) + e2 * m2 * sens(c, e2) + carry * sens(c, carry) + e3 + seasonEffect;
      S.pf[c.id] = Math.max(3, S.pf[c.id] * (1 + e1 * m1 * sens(c, e1)) * (1 + e2 * m2 * sens(c, e2)) * (1 + carry * sens(c, carry)) * (1 + e3));
      if (noiseMoves[c.id] != null && !e3) {
        S.pf[c.id] = noiseMoves[c.id];
        noiseIds.push(c.id);
      }
      S.price[c.id] = Math.max(5, Math.round(S.pf[c.id]));
      S.hist[c.id].push(S.price[c.id]);
    });
    S.log.push({
      day: S.day, flow: copy(S.flow), kind: d.morning.kind, eff: d.morning.effects || {},
      holdVals: holdVals, cashFrac: tradingTotal > 0 ? S.cash / tradingTotal : 1, risk: d.risk
    });
    S.active = S.lvl === 2 ? activeToday.filter(function (a) { a.left--; return a.left > 0; }) : [];
    if (S.lvl === 2) morn(d).concat(eve(d)).forEach(function (n) { if (n.durationDays > 1) S.active.push({ news: n, left: n.durationDays - 1 }); });
    S.last = { before: before, after: S.cash + holdingsValue(S.price), old: old, eveningOld: eveningOld, neu: copy(S.price), d: d, owned: copy(S.shares), newsImpact: newsImpact, reasons: reasons, noiseIds: noiseIds };
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
    C.companies.forEach(function (c) { if (L.owned[c.id] > 0 || (d.seasonOwned && d.seasonOwned[c.id] > 0)) hadShares = true; });
    var msg, cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    if (!hadShares) msg = O.empty;
    else if (Math.round(delta) >= 1) msg = fill(O.gain, { n: coins(delta) });
    else if (Math.round(delta) <= -1) msg = fill(O.loss, { n: coins(delta) });
    else msg = O.flat;

    var rows = C.companies.map(function (c) {
      var o = L.old[c.id], n = L.neu[c.id], pc = Math.round((n - o) / o * 100);
      var qty = L.owned[c.id] || 0;
      var own = qty * (n - L.eveningOld[c.id]) + ((d.seasonContributions && d.seasonContributions[c.id]) || 0);
      var k = pc > 0 ? 'up' : pc < 0 ? 'down' : 'flat';
      var impact = L.newsImpact[c.id] || 0;
      var reasons = L.reasons[c.id] || [];
      return {
        sort: Math.abs(impact) * 1000 + Math.abs(pc),
        html: '<div class="rrow"><div class="rrow-top"><div class="ic" style="--c:' + esc(c.color) + '">' + esc(c.emoji) + '</div>' +
          '<div class="nm">' + esc(c.name) + (qty ? '<span class="mine">у тебя ' + qty + ' шт.</span>' : '') + '<small>' + nf(o) + ' → ' + nf(n) + '</small></div>' +
          '<div class="pc ' + k + '">' + (pc > 0 ? '▲ +' : pc < 0 ? '▼ −' : '● ') + Math.abs(pc) + '%' +
          (qty || own ? '<small class="' + (own > 0 ? 'up' : own < 0 ? 'down' : 'flat') + '">' + signed(own) + ' ' + coinWord(own) + '</small>' : '') + '</div></div>' +
          reasons.map(function (r) { return '<div class="why"><span class="why-arrow ' + r.direction + '" aria-label="' +
            (r.direction === 'up' ? 'Положительное влияние' : 'Отрицательное влияние') + '">' +
            (r.direction === 'up' ? '↑' : '↓') + '</span><span>' + esc(r.text) + '</span></div>'; }).join('') + '</div>'
      };
    }).sort(function (a, b) { return b.sort - a.sort; });

    var concept = null;
    if (S.lvl === 1) (C.texts.concepts || []).forEach(function (x) { if (x.id === d.concept) concept = x; });
    var lastDay = S.day >= C.schedule.length - 1;
    var recap = (d.seasonEvent ? [esc(d.seasonEvent.emoji) + ' ' + esc(d.seasonEvent.title)] : []).concat(
      morn(d).map(function (n) { return '📰 Утро: ' + esc(n.title); }),
      eve(d).map(function (n) { return '🌙 Вечер: ' + esc(n.title); })).join('<br>');

    show(
      '<section class="screen">' +
        '<div class="daytag">День ' + (S.day + 1) + ' из ' + C.schedule.length + ' · итоги дня</div>' +
        '<div class="card sum"><div class="from">Было ' + nf(L.before) + '</div>' +
        '<div class="big ' + cls + '"><span id="tot">' + nf(L.before) + '</span></div>' +
        '<div class="' + cls + '" style="font-weight:800" id="dl">&nbsp;</div></div>' +
        '<div class="mascot-row">' + mascot() + '<div class="bubble">' + esc(msg) + '</div></div>' +
        '<div class="recap">' + recap + '</div>' +
        (L.noiseIds.length ? '<p class="market-note">Цены компаний иногда слегка колеблются без видимых причин. Сегодня это: ' +
          L.noiseIds.map(function (id) { return '«' + esc(co(id).name) + '»'; }).join(', ') + '.</p>' : '') +
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
    var praise = !S.closed ? 'Ты пока не продавал акции — подождать тоже можно.' :
      S.profitable === S.closed ? 'Все твои продажи принесли прибыль!' :
      S.profitable > S.closed / 2 ? 'Большая часть твоих продаж принесла прибыль!' :
      S.profitable ? 'У тебя есть прибыльные продажи. Продолжай наблюдать за новостями!' :
      'Не каждая продажа приносит прибыль. Ты учишься замечать причины изменений.';
    show('<section class="screen final-screen"><div class="final-top"><div class="em">' + (pct >= 0 ? '🎉' : '🌟') + '</div><h2>Итоги игры</h2></div>' +
      '<div class="card final-metric"><span>Общая доходность</span><strong class="' + (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat') + '">' +
      (pct > 0 ? '+' : '') + pct.toFixed(1).replace('.', ',') + '%</strong><small>' + nf(C.startCoins) + ' → ' + nf(mine) + ' монет</small>' +
      '<p>Твой результат за ' + C.schedule.length + ' игровых дней.</p></div>' +
      '<div class="card final-chart"><h2>Стоимость портфеля по дням</h2>' + portfolioChart(S.daily) + '</div>' +
      (S.lvl === 2 ? '<div class="card final-metric"><span>Успешные сделки</span><strong>' + S.profitable + '</strong>' +
      '<small>из ' + S.closed + ' ' + (S.closed === 1 ? 'продажи' : 'продаж') + '</small><p>' + esc(praise) + '</p></div>' : '') +
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
    if (!t || t.disabled) return;
    var act = t.getAttribute('data-act');
    switch (act) {
      case 'start':
        t.textContent = 'Загрузка…';
        contentPromise.then(function (c) { C = c; renderLevel(); });
        break;
      case 'backToStart': renderStart(); play('tap'); break;
      case 'introBack': renderLevel(S.lvl); break;
      case 'backToIntro': renderIntro(introIndex); play('tap'); break;
      case 'introNext': {
        if (introIndex + 1 < intros().length) updateIntro(introIndex + 1, 1); else renderCompanies();
        play('tap'); break;
      }
      case 'introPrev': if (introIndex > 0) updateIntro(introIndex - 1, -1); play('tap'); break;
      case 'level': selectLevel(parseInt(t.getAttribute('data-v'), 10)); break;
      case 'beginRun':
        if (selectedLevel == null) break;
        newRun(selectedLevel);
        if (t.getAttribute('data-training') === 'true') renderIntro(0); else renderNews();
        break;
      case 'introSkip': renderCompanies(); break;
      case 'beginGame': renderNews(); break;
      case 'toMarket': play('tap'); renderMarket(); break;
      case 'companyInfo': {
        if (!S || S.phase !== 'market') break;
        var id = t.getAttribute('data-id'), card = t.closest('.co'), panel = card.querySelector('.company-info-panel');
        if (!panel) break;
        var open = !S.infoOpen[id];
        S.infoOpen[id] = open;
        panel.hidden = !open;
        card.classList.toggle('info-open', open);
        t.setAttribute('aria-expanded', open ? 'true' : 'false');
        play('tap'); break;
      }
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
        refreshMarket();
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
    $('#btnBack').addEventListener('click', onClick);
    $('#btnSound').addEventListener('click', toggleSound);
    contentPromise = loadContent();
    renderStart();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
