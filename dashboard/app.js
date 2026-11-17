// Token Launch Radar — the page. Everything renders from window.RADAR, the
// data file main.ts writes beside dashboard/ from the same board it hands in:
// what the board.json says is what this page shows. No network, no framework.

(function () {
  'use strict';
  var DATA = window.RADAR;
  var rows = DATA.rows;
  var state = { q: '', cat: '', chain: '', sort: 'rank', watch: false, slug: null };

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }

  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---- header: the snapshot and the coverage, in numbers -------------------
  var s = DATA.stats;
  $('stats').innerHTML =
    '<div><dt>Protocols scanned</dt><dd>' + s.protocols + '</dd></div>' +
    '<div><dt>Pre-token ranked</dt><dd>' + s.ranked + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + s.watchlist_covered + ' / ' + s.watchlist + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd></div>';

  $('model-note').innerHTML =
    '<strong>The model.</strong> Implied value = TVL × <strong>peer multiple</strong> × momentum × maturity. ' +
    'The peer multiple is the median market-cap / TVL of the snapshot&rsquo;s own listed protocols in the same ' +
    'category (the all-market median, <code>' + s.global_multiple.toFixed(3) + '×</code> from ' + s.listed_peers +
    ' listed peers, when a category has fewer than three). Momentum reads the 7-day TVL change, clamped; ' +
    'maturity adds up to 30% for years run tokenless. Every figure comes from the sealed snapshot — ' +
    'no outside prices, no hand-picked names. Model <code>' + esc(DATA.model_version) + '</code>.';

  $('foot').textContent =
    'Source: ' + DATA.source + ' · Floor for the house watchlist: ' + money(DATA.floor_usd) +
    ' TVL · An implied value is this board\u2019s own claim about a launch that has not happened; it is not a prediction that a token will be issued.';

  // ---- filters --------------------------------------------------------------
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });

  function visible() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
  }

  function sorted(list) {
    var key = state.sort;
    var out = list.slice();
    out.sort(function (a, b) {
      if (key === 'rank') return a.rank - b.rank;
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || -999) - (a.change_7d || -999);
      if (key === 'age') return (b.age_days || -1) - (a.age_days || -1);
      if (key === 'multiple') return b.model.peer_multiple - a.model.peer_multiple;
      return a.rank - b.rank;
    });
    return out;
  }

  function render() {
    var list = sorted(visible());
    $('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' ranked protocols' +
      (state.watch ? ' · watchlist only' : '') + (state.cat ? ' · ' + state.cat : '') + (state.chain ? ' · ' + state.chain : '');
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.slug === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + (r.on_watchlist ? '<span class="star" title="On the house watchlist">★ watchlist</span>' : '') +
        '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + r.model.peer_multiple.toFixed(3) + '×</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td></tr>';
    });
    $('rows').innerHTML = html;
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { openDetail(this.getAttribute('data-slug')); });
    }
  }

  // ---- detail view ------------------------------------------------------------
  function openDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.slug = slug;
    var m = r.model;
    var factors =
      '<table class="factors">' +
      '<tr><td>TVL (snapshot)</td><td class="num">' + money(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Peer multiple — median market cap / TVL of ' + m.peer_count + ' listed peers (' + esc(m.peer_scope) + ')</td><td class="num">× ' + m.peer_multiple.toFixed(3) + '</td></tr>' +
      '<tr><td>Momentum — 7-day TVL change ' + pct(r.change_7d) + ', clamped</td><td class="num">× ' + m.momentum_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td>Maturity — ' + (r.age_days === null ? 'age unrecorded' : r.age_days + ' days tokenless') + '</td><td class="num">× ' + m.maturity_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td><strong>Implied value if launched at peer pricing</strong></td><td class="num implied">' + money(r.implied_value_usd) + '</td></tr>' +
      '</table>';
    var steps = r.farm_steps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    $('detail').innerHTML =
      '<button class="close" type="button" id="detail-close">Close ✕</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + (r.on_watchlist ? ' <span class="star" style="color:var(--mark);font-size:14px">★ on the house watchlist</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'chain unrecorded') +
      ' · tracked since ' + esc(r.listed_at || 'an unrecorded date') + ' · records no token yet</p>' +
      '<div class="grid"><div><h3>How the value is built</h3>' + factors + '</div>' +
      '<div><h3>Farm plan — what to do before a launch</h3><ol>' + steps + '</ol></div></div>';
    $('detail').hidden = false;
    $('detail-close').addEventListener('click', function () {
      $('detail').hidden = true; state.slug = null; render();
    });
    render();
    $('detail').scrollIntoView({ block: 'nearest' });
  }

  // ---- set-aside view -----------------------------------------------------------
  function renderAside() {
    var html = '';
    DATA.aside.forEach(function (a) {
      html += '<tr><td><span class="name">' + esc(a.name) + '</span><span class="slug">' + esc(a.slug) + '</span></td>' +
        '<td>' + esc(a.category || '—') + '</td><td class="num">' + money(a.tvl_usd) + '</td>' +
        '<td class="num">' + money(a.mcap_usd) + '</td><td>' + esc(a.reason) + '</td></tr>';
    });
    $('aside-rows').innerHTML = html;
  }
  renderAside();
  $('aside-toggle').addEventListener('click', function () {
    var el = $('aside');
    el.hidden = !el.hidden;
    if (!el.hidden) el.scrollIntoView({ block: 'nearest' });
  });

  // ---- wiring -------------------------------------------------------------------
  $('q').addEventListener('input', function () { state.q = this.value; render(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; render(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; render(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; render(); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; render(); });

  // Deep links for the three canonical views: #p=<slug> detail, #cat=<category> filtered.
  var hash = window.location.hash.replace(/^#/, '');
  if (hash.indexOf('p=') === 0) {
    render();
    openDetail(decodeURIComponent(hash.slice(2)));
  } else if (hash.indexOf('cat=') === 0) {
    state.cat = decodeURIComponent(hash.slice(4));
    $('cat').value = state.cat;
    render();
  } else {
    render();
  }
})();
