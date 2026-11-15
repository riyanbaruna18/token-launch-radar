// Token Radar dashboard: renders window.RADAR with no network and no fetch.
// State lives in the URL hash so a view can be linked and screenshotted:
//   #tab=board|live|model  #detail=<slug>  #cat=<category>  #chain=<chain>
//   #watch=1  #q=<text>  #sort=rank|tvl|growth|age|confidence

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) {
    document.body.innerHTML = '<p style="padding:24px">Radar data is missing: run main.ts first so data.js sits beside this page.</p>';
    return;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n == null) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '—';
    var v = (Math.round(n * 10) / 10).toFixed(1);
    return (n > 0 ? '+' : '') + v + '%';
  }
  function cls(n) { return n == null ? '' : (n > 0 ? 'pos' : (n < 0 ? 'neg' : '')); }
  function age(n) { return n == null ? '—' : n + 'd'; }

  function parseHash() {
    var out = {};
    var h = location.hash.replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  function writeHash(state) {
    var parts = [];
    ['tab', 'detail', 'cat', 'chain', 'watch', 'q', 'sort'].forEach(function (k) {
      if (state[k]) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(state[k]));
    });
    var next = parts.length ? '#' + parts.join('&') : '#';
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  var state = {
    tab: 'board', detail: '', cat: '', chain: '', watch: '', q: '', sort: 'rank',
  };
  var initial = parseHash();
  Object.keys(initial).forEach(function (k) { if (k in state) state[k] = initial[k]; });

  var $ = function (id) { return document.getElementById(id); };
  var bySlug = {};
  R.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---- stats strip ----
  var top = R.rows[0];
  $('stats').innerHTML = [
    ['Protocols', R.rows.length + ' ranked'],
    ['Watchlist', R.watchlist_size + ' tracked'],
    ['Top implied value', top ? money(top.implied_value_usd) : '—'],
    ['Snapshot', R.as_of],
    ['Model', R.model_version],
  ].map(function (kv) {
    return '<div><dt>' + kv[0] + '</dt><dd>' + esc(kv[1]) + '</dd></div>';
  }).join('');

  // ---- filter controls ----
  var cats = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  // ---- tabs ----
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    $('view-board').hidden = tab !== 'board';
    $('view-live').hidden = tab !== 'live';
    $('view-model').hidden = tab !== 'model';
    if (tab === 'live') renderLive();
    if (tab === 'model') renderModel();
    writeHash(state);
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  // ---- board ----
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && !r.watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d == null ? -Infinity : b.change_7d) - (a.change_7d == null ? -Infinity : a.change_7d);
      if (key === 'age') return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days);
      if (key === 'confidence') return b.confidence - a.confidence;
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    $('count').textContent = rows.length + ' of ' + R.rows.length + ' protocols' +
      (state.watch ? ' on the watchlist' : '') +
      (state.cat ? ' in ' + state.cat : '') + '.';
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + (r.watchlist ? ' <span class="watch" title="On the watchlist">★</span>' : '') + '<br><span style="color:var(--faint);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + r.chains.map(function (c) { return '<span class="pill">' + esc(c) + '</span>'; }).join(' ') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + r.confidence + '</td>' +
        '</tr>';
    }).join('');
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug');
        renderDetail();
        renderBoardSelection();
        writeHash(state);
      });
    });
    renderDetail();
  }
  function renderBoardSelection() {
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === state.detail);
    });
  }

  function bar(label, value, max, shown) {
    var w = Math.max(2, Math.min(100, Math.round((value / max) * 100)));
    return '<div class="bar-row"><span>' + esc(label) + '</span><span class="bar"><i style="width:' + w + '%"></i></span><span class="val">' + esc(shown) + '</span></div>';
  }

  function renderDetail() {
    var box = $('detail');
    var r = state.detail ? bySlug[state.detail] : null;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var mults = [
      ['Category multiple', r.category_multiple, 0.6, r.category_multiple.toFixed(3) + '×'],
      ['Growth', r.growth_multiplier, 1.6, r.growth_multiplier.toFixed(3) + '×'],
      ['Maturity', r.maturity_multiplier, 1.0, r.maturity_multiplier.toFixed(3) + '×'],
      ['Chains', r.chain_multiplier, 1.1, r.chain_multiplier.toFixed(3) + '×'],
    ];
    box.hidden = false;
    box.innerHTML =
      '<h2><span class="rank">#' + r.rank + '</span> ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'No category') + ' · ' +
      r.chains.map(esc).join(', ') + (r.watchlist ? ' · <span class="watch">★ Watchlist</span>' : '') + '</p>' +
      '<dl class="kv">' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd class="' + cls(r.change_7d) + '">' + pct(r.change_7d) + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + age(r.age_days) + '</dd></div>' +
      '<div><dt>Listed</dt><dd>' + esc(r.listed_at || '—') + '</dd></div>' +
      '<div><dt>Confidence</dt><dd>' + r.confidence + ' / 100</dd></div>' +
      '</dl>' +
      '<h3>Model breakdown</h3><div class="bars">' +
      mults.map(function (m) { return bar(m[0], m[1], m[2], m[3]); }).join('') +
      '</div>' +
      '<p style="color:var(--muted)">implied = TVL × ' + r.category_multiple.toFixed(3) + ' × ' + r.growth_multiplier.toFixed(3) + ' × ' + r.maturity_multiplier.toFixed(3) + ' × ' + r.chain_multiplier.toFixed(3) + '</p>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
  }

  // ---- live view ----
  var liveRendered = false;
  function renderLive() {
    if (liveRendered) return;
    liveRendered = true;
    $('live-rows').innerHTML = R.live.map(function (r) {
      return '<tr><td><strong>' + esc(r.name) + '</strong><br><span style="color:var(--faint);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + r.chains.map(function (c) { return '<span class="pill">' + esc(c) + '</span>'; }).join(' ') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(r.mcap_usd) + '</strong></td>' +
        '<td class="num ' + cls(r.change_7d) + '">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  // ---- model view ----
  var modelRendered = false;
  function renderModel() {
    if (modelRendered) return;
    modelRendered = true;
    var m = R.model;
    var rows = [
      ['Model version', R.model_version],
      ['Base multiple fallback', m.base_multiple_fallback + ' (global median mcap/TVL)'],
      ['Multiple prior weight', String(m.multiple_prior_weight)],
      ['Multiple band', m.multiple_floor + ' – ' + m.multiple_cap],
      ['Growth scale / weight', m.growth_scale + ' / ' + m.growth_weight],
      ['Growth clamp', m.growth_floor + '% … +' + m.growth_cap + '%'],
      ['Maturity peak', m.maturity_peak_days + ' days'],
      ['Maturity floor / range', m.maturity_floor + ' / ' + m.maturity_range],
      ['Maturity decay', m.maturity_decay_days + ' days to ' + m.maturity_decay_floor],
      ['Unknown age', m.unknown_age_days + ' days'],
      ['Chain step (max ' + m.chain_cap_steps + ')', '+' + m.chain_step + ' per chain'],
    ];
    $('consts').innerHTML = rows.map(function (kv) {
      return '<dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd>';
    }).join('');
  }

  // ---- wire controls ----
  function syncControls() {
    $('q').value = state.q;
    $('cat').value = state.cat;
    $('chain').value = state.chain;
    $('watch').checked = state.watch === '1';
    $('sort').value = state.sort;
  }
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); writeHash(state); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; renderBoard(); writeHash(state); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; renderBoard(); writeHash(state); });
  $('watch').addEventListener('change', function () { state.watch = $('watch').checked ? '1' : ''; renderBoard(); writeHash(state); });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; renderBoard(); writeHash(state); });
  window.addEventListener('hashchange', function () {
    var h = parseHash();
    Object.keys(state).forEach(function (k) { state[k] = h[k] || (k === 'tab' ? 'board' : k === 'sort' ? 'rank' : ''); });
    syncControls();
    showTab(state.tab);
    renderBoard();
  });

  syncControls();
  showTab(state.tab);
  renderBoard();
})();
