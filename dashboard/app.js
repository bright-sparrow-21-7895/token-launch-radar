// Token Launch Radar — the page. Plain script, no framework, no network: it renders window.RADAR
// (zz-board-data.js, written by main.ts from the same board as board.json) as a sortable,
// filterable board, a per-protocol detail view, a model section that shows the valuation's
// arithmetic, and a strip of token-bearing protocols kept apart from the ranking. The view is
// addressed by the URL hash — #/board?chain=..&cat=..&wl=1&q=..&sort=.. and #/protocol/<slug> —
// so every view can be opened, linked and screenshotted directly.
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('app');
  if (!D || !app) return;

  var esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var usd = function (n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  };
  var pct = function (n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; };
  var age = function (d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  };
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var lastBoard = '#/board';

  // ------------------------------------------------------------- routing
  function route() {
    var h = location.hash || '#/board';
    var q = h.indexOf('?');
    var path = q < 0 ? h : h.slice(0, q);
    var params = new URLSearchParams(q < 0 ? '' : h.slice(q + 1));
    if (path.indexOf('#/protocol/') === 0) return detail(decodeURIComponent(path.slice(11)));
    lastBoard = h;
    return board(params);
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function boardHash(st) {
    var p = new URLSearchParams();
    if (st.chain !== 'all') p.set('chain', st.chain);
    if (st.cat !== 'all') p.set('cat', st.cat);
    if (st.wl) p.set('wl', '1');
    if (st.q) p.set('q', st.q);
    if (st.sort !== 'rank') p.set('sort', st.sort);
    if (st.dir !== 1) p.set('dir', String(st.dir));
    var s = p.toString();
    return '#/board' + (s ? '?' + s : '');
  }

  // ------------------------------------------------------------- the board
  function board(params) {
    var st = {
      chain: params.get('chain') || 'all', cat: params.get('cat') || 'all',
      wl: params.get('wl') === '1', q: params.get('q') || '',
      sort: params.get('sort') || 'rank', dir: Number(params.get('dir') || 1),
    };
    var chains = {}, cats = {};
    D.rows.forEach(function (r) {
      r.chains.forEach(function (c) { chains[c] = 1; });
      if (r.category) cats[r.category] = 1;
    });
    var rows = D.rows.filter(function (r) {
      if (st.wl && !r.watchlist) return false;
      if (st.chain !== 'all' && r.chains.indexOf(st.chain) < 0) return false;
      if (st.cat !== 'all' && r.category !== st.cat) return false;
      if (st.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
      return true;
    });
    var key = { rank: 'rank', name: 'name', category: 'category', tvl: 'tvl_usd', change: 'change_7d', age: 'age_days', implied: 'implied_value_usd', ratio: 'ratio' }[st.sort] || 'rank';
    rows.sort(function (a, b) {
      var va = key === 'ratio' ? a.model.ratio : a[key], vb = key === 'ratio' ? b.model.ratio : b[key];
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      var c = typeof va === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : va - vb;
      return c * st.dir || a.rank - b.rank;
    });
    var opt = function (v, cur, label) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label || v) + '</option>'; };
    var th = function (label, k, cls) {
      var arrow = st.sort === k ? (st.dir === 1 ? ' ↑' : ' ↓') : '';
      return '<th class="' + (cls || '') + '" data-sort="' + k + '">' + label + arrow + '</th>';
    };
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></span>' +
        (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '<span class="badge early">EARLY</span>') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + r.chains.slice(0, 3).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + (r.chains.length > 3 ? '<span class="muted">+' + (r.chains.length - 3) + '</span>' : '') + '</td>' +
        '<td class="r">' + usd(r.tvl_usd) + '</td>' +
        '<td class="r ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="r">' + age(r.age_days) + '</td>' +
        '<td class="r">' + r.model.ratio.toFixed(3) + '×</td>' +
        '<td class="val">' + usd(r.implied_value_usd) + '</td></tr>';
    }).join('');
    app.innerHTML =
      head() +
      '<div class="lede"><div><h1>Protocols that record no token yet, ranked by what a launch could be worth.</h1>' +
      '<p>Every row is a protocol whose DefiLlama record carries no token — no CoinGecko id, no symbol, no market cap. ' +
      'The radar prices a hypothetical launch from the snapshot\'s own figures: TVL times the market-cap/TVL ratio the ' +
      'snapshot\'s token-bearing protocols actually trade at, adjusted for seven-day momentum and for how long the ' +
      'protocol has run. Wrapped, staked, bridged and exchange products of tokens that already trade are excluded by ' +
      'the house rule. Click any row for its valuation breakdown and farm plan.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + D.board_size + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + D.watchlist_size + ' / ' + D.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + D.early_size + '</b><span>early finds below the floor</span></div>' +
      '<div class="stat"><b>' + D.model.global_ratio.toFixed(3) + '×</b><span>global median mcap / TVL</span></div>' +
      '</div></div>' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(st.q) + '">' +
      '<select id="chain"><option value="all">All chains</option>' + Object.keys(chains).sort().map(function (c) { return opt(c, st.chain); }).join('') + '</select>' +
      '<select id="cat"><option value="all">All categories</option>' + Object.keys(cats).sort().map(function (c) { return opt(c, st.cat); }).join('') + '</select>' +
      '<label class="chk"><input type="checkbox" id="wl"' + (st.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + D.board_size + ' shown</span></div>' +
      '<table><thead><tr>' + th('#', 'rank') + th('Protocol', 'name') + th('Category', 'category') + '<th>Chains</th>' +
      th('TVL', 'tvl', 'r') + th('7d', 'change', 'r') + th('Age', 'age', 'r') + th('Ratio', 'ratio', 'r') + th('Implied value', 'implied', 'r') +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>') + '</tbody></table>' +
      modelSection() + liveSection() + foot();
    app.removeAttribute('aria-busy');
    var upd = function () {
      go(boardHash({ chain: document.getElementById('chain').value, cat: document.getElementById('cat').value, wl: document.getElementById('wl').checked, q: document.getElementById('q').value, sort: st.sort, dir: st.dir }));
    };
    document.getElementById('chain').addEventListener('change', upd);
    document.getElementById('cat').addEventListener('change', upd);
    document.getElementById('wl').addEventListener('change', upd);
    var search = document.getElementById('q'), timer = null;
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { var v = search.value, pos = search.selectionStart; go(boardHash({ chain: st.chain, cat: st.cat, wl: st.wl, q: v, sort: st.sort, dir: st.dir })); var s2 = document.getElementById('q'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } }, 350); });
    app.querySelectorAll('thead th[data-sort]').forEach(function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-sort');
        var dir = st.sort === k ? -st.dir : (k === 'name' || k === 'category' ? 1 : -1);
        if (st.sort !== k && k === 'rank') dir = 1;
        go(boardHash({ chain: st.chain, cat: st.cat, wl: st.wl, q: st.q, sort: k, dir: dir }));
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { go('#/protocol/' + encodeURIComponent(tr.getAttribute('data-slug'))); });
    });
  }

  function head() {
    return '<div class="wrap"><div class="top"><div><div class="brand"><span class="dot"></span>Token Launch Radar</div>' +
      '<div class="muted" style="margin-top:6px">Model ' + esc(D.model_version) + ' · snapshot ' + esc(D.as_of) + '</div></div>' +
      '<div class="top-meta">source: ' + esc(D.source) + '<br>watchlist floor ' + usd(D.floor_usd) + ' TVL · no network, sealed data</div></div>';
  }
  function foot() {
    return '<footer>Implied value is this board\'s own claim: what a launch would be worth if the protocol\'s record stayed ' +
      'as it is and the market priced it like the snapshot\'s token-bearing peers. It is not a prediction that a token ' +
      'will be issued. A protocol is described as recording no token, never as having none: a record can lag a launch.</footer></div>';
  }

  function modelSection() {
    var m = D.model;
    var cats = m.categories.filter(function (c) { return c.used; }).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="r">' + c.samples + '</td><td class="r">' + c.ratio.toFixed(3) + '×</td></tr>';
    }).join('');
    return '<section class="block"><h2>How the value model works</h2>' +
      '<p>Each protocol is priced off its peers, not off a list of names. First the snapshot\'s token-bearing protocols ' +
      'give a market-cap/TVL ratio per category (the median, so one outlier cannot set the price); a category with fewer ' +
      'than ' + m.min_samples + ' samples falls back to the global median of ' + m.global_ratio.toFixed(3) + '× over ' + m.global_samples + ' protocols. ' +
      'Then the protocol\'s own record adjusts that base: seven-day TVL momentum, clamped to ' + m.growth_floor_pct + '%…+' + m.growth_cap_pct + '% ' +
      'and weighted ' + m.growth_weight + ', and a maturity premium for time run with no token recorded, from ' + m.age_floor + '× for a new ' +
      'listing up to ' + (m.age_floor + m.age_range).toFixed(2) + '× at ' + m.age_cap_days + ' days. Every row of the board carries its own ratio, ' +
      'basis and multipliers — open a protocol to see its arithmetic.</p>' +
      '<div class="formula">implied value = TVL × category mcap/TVL (median) × (1 + clamp(change_7d, −50%, +100%) × 0.35) × (0.85 + 0.30 × min(age_days, 1460) / 1460)</div>' +
      '<div class="grid2"><div><h3>Category ratios used (median mcap / TVL)</h3><table class="mini"><thead><tr><th>Category</th><th class="r">Samples</th><th class="r">Ratio</th></tr></thead><tbody>' + cats + '</tbody></table></div>' +
      '<div><h3>Who is on the board, who is not</h3><p>The board holds the full ' + D.watchlist_size + '-protocol watchlist ' +
      '(TVL at or above ' + usd(D.floor_usd) + ', no token recorded, house exclusion rule passed) plus ' + D.early_size + ' early protocols below ' +
      'the floor that pass the same rule — the floor is a starting line, not a ceiling. Protocols whose token already ' +
      'trades are never ranked here; the strip below shows the largest of them at the market\'s own prices, which is ' +
      'also where the ratios above come from.</p></div></div></section>';
  }

  function liveSection() {
    var rows = D.live.map(function (r) {
      var ratio = r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) + '×' : 'n/a';
      return '<tr><td><span class="pname">' + esc(r.name) + '</span></td><td>' + esc(r.category || '—') + '</td>' +
        '<td class="r">' + usd(r.tvl_usd) + '</td><td class="r">' + usd(r.mcap_usd) + '</td><td class="r">' + ratio + '</td>' +
        '<td class="r ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
    return '<section class="block"><h2>Already trading — set aside, not ranked</h2>' +
      '<p>These protocols record a token, so the market has already priced them. They are the comparison set behind the model\'s ratios.</p>' +
      '<table class="mini"><thead><tr><th>Protocol</th><th>Category</th><th class="r">TVL</th><th class="r">Market cap</th><th class="r">Mcap / TVL</th><th class="r">7d</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
  }

  // ------------------------------------------------------------- detail
  function detail(slug) {
    var r = bySlug[slug];
    if (!r) { go('#/board'); return; }
    var m = r.model;
    var product = Math.round(r.tvl_usd * m.ratio * m.growth_multiplier * m.age_multiplier);
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    app.innerHTML = head() +
      '<p style="margin-top:14px"><a class="back" href="' + esc(lastBoard) + '">← back to the board</a></p>' +
      '<div class="dhead"><h1>' + esc(r.name) + '</h1>' +
      (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '<span class="badge early">EARLY · BELOW THE FLOOR</span>') +
      '<span class="muted num">' + esc(r.slug) + '</span></div>' +
      '<p class="muted">Records no token in the snapshot (no CoinGecko id, no symbol, no market cap). Rank #' + r.rank + ' of ' + D.board_size + ' by implied value.</p>' +
      '<div class="cards">' +
      '<div class="card hero"><span>Implied value</span><b>' + usd(r.implied_value_usd) + '</b></div>' +
      '<div class="card"><span>TVL</span><b>' + usd(r.tvl_usd) + '</b></div>' +
      '<div class="card"><span>7d TVL change</span><b class="' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</b></div>' +
      '<div class="card"><span>Category</span><b style="font-family:var(--font);font-size:15px">' + esc(r.category || '—') + '</b></div>' +
      '<div class="card"><span>Tracked since</span><b>' + esc(r.listed_at || 'unknown') + '</b></div>' +
      '<div class="card"><span>Age</span><b>' + age(r.age_days) + '</b></div></div>' +
      '<h2>Chains</h2><p style="margin:8px 0 18px">' + r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</p>' +
      '<h2>Why this value — the model\'s arithmetic</h2>' +
      '<div class="arith" style="margin-top:10px">' +
      '<div><span>TVL (snapshot)</span><span>' + usd(r.tvl_usd) + '</span></div>' +
      '<div><span>× ratio — ' + (m.ratio_basis === 'category' ? esc(r.category || '') + ' median' : 'global median (category sample too small)') + ', ' + m.ratio_samples + ' samples</span><span>' + m.ratio.toFixed(3) + '×</span></div>' +
      '<div><span>× growth — 7d change ' + pct(m.growth_pct) + ' clamped, weight ' + D.model.growth_weight + '</span><span>' + m.growth_multiplier.toFixed(3) + '×</span></div>' +
      '<div><span>× maturity — ' + (r.age_days === null ? 'age unreported, neutral' : age(r.age_days) + ' run with no token recorded') + '</span><span>' + m.age_multiplier.toFixed(3) + '×</span></div>' +
      '<div class="tot"><span>= implied value</span><span>' + usd(r.implied_value_usd) + '</span></div></div>' +
      '<p class="muted" style="margin-top:8px">Factors are shown rounded; the board\'s value is computed before rounding (product of the rounded factors: ' + usd(product) + ').</p>' +
      '<section class="block"><h2>Farm plan — what to do before a launch</h2>' +
      '<p>Concrete steps for ' + esc(r.name) + ' on ' + esc(r.chains[0] || 'its main chain') + ', each with its cost and time. A plan is preparation, not a promise: the snapshot records no points program and no launch date.</p>' +
      '<ol class="steps">' + steps + '</ol></section>' + foot();
    app.removeAttribute('aria-busy');
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();
})();
