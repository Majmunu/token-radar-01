// Token Radar dashboard, rewritten from the kit starter.
// Reads window.RADAR (written beside dashboard/ by main.ts) and renders the ranked board,
// the filters, and a per-protocol detail drawer carrying the model's inputs and farm plan.
// No network: every byte on screen comes from data.js.
(() => {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const mount = document.getElementById('board');

  // What the viewer is looking at right now: search text, filters, sort and the open protocol.
  const view = {
    query: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sortKey: 'implied',
    sortDir: -1,
    selected: null,
  };

  const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function money(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    const size = Math.abs(n);
    if (size >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (size >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (size >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdWhole.format(n);
  }

  function pct(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, recomputed in the page from the snapshot figures, so the number the page shows
  // can be checked against the number board.json carries for the same row.
  function recomputeImplied(row, model) {
    const weekly = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const clamped = Math.min(model.growth_cap, Math.max(model.growth_floor, weekly));
    const growthFactor = 1 + (clamped / 100) * model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const boundedAge = Math.min(Math.max(age, 0), model.maturity_days);
    const maturityFactor = model.maturity_floor + (boundedAge / model.maturity_days) * model.maturity_range;
    const chainCount = (row.chains || []).length;
    const chainFactor = 1 + model.chain_step * Math.min(Math.max(chainCount - 1, 0), model.chain_cap);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthFactor * maturityFactor * chainFactor));
  }

  // A small DOM builder: h('div', {class: 'x', text: 'hi'}, child, [more]) — attributes first,
  // then any mix of nodes, strings and arrays of nodes.
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    const push = (kid) => {
      if (kid === null || kid === undefined) return;
      if (Array.isArray(kid)) kid.forEach(push);
      else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    };
    kids.forEach(push);
    return node;
  }

  // --- Farm plan: the same derivation main.ts writes into board.json -------------------------
  // Category, chains, TVL and age decide the action, the capital, the hold and every cost and
  // time. No protocol name is special-cased anywhere in this table.

  function firstChain(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function halfStake(capital) {
    return Math.max(10, Math.round(capital / 2));
  }

  // Each entry matches a category by substring, in order, and supplies the main action and the
  // second, different qualifying action for that kind of protocol.
  const PLAN_KINDS = [
    {
      keys: ['lend', 'cdp', 'collateral'],
      main: (name, capital, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.',
      second: (name, capital) => 'Borrow $' + halfStake(capital) + ' against the supplied collateral on ' + name + ' and repay it within the same week.',
    },
    {
      keys: ['dex', 'yield', 'leveraged farm'],
      main: (name, capital, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.',
      second: (name, capital, chain) => 'Swap $' + halfStake(capital) + " through " + name + "'s main pool on " + chain + ' and add the proceeds back as liquidity.',
    },
    {
      keys: ['bridge'],
      main: (name, capital, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.',
      second: null,
    },
    {
      keys: ['staking', 'restak'],
      main: (name, capital) => "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.',
      second: null,
    },
    {
      keys: ['perpetual', 'derivative'],
      main: (name, capital) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.',
      second: (name, capital) => 'Close the first hedge on ' + name + ' and open a second one half the size, on the opposite side.',
    },
    {
      keys: ['prediction'],
      main: (name, capital) => 'Fund $' + capital + ' and place one market position on ' + name + '.',
      second: (name) => 'Settle the first market position on ' + name + ' and place a second one on a different outcome.',
    },
    {
      keys: ['curator', 'allocator'],
      main: (name, capital, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.',
      second: (name, capital, chain) => 'Deposit a second $' + halfStake(capital) + ' into a different ' + name + ' vault on ' + chain + ' and keep both shares.',
    },
    {
      keys: ['stable'],
      main: (name, capital, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.',
      second: (name, capital, chain) => 'Swap $' + halfStake(capital) + ' of the stable asset for USDC on ' + chain + ' and deposit it back through ' + name + '.',
    },
    {
      keys: ['rwa'],
      main: (name, capital, chain) => "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.',
      second: (name) => 'Reinvest the first yield payout from ' + name + ' into the same asset and keep the receipt.',
    },
    {
      keys: ['insurance'],
      main: (name, capital) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.',
      second: (name) => 'File a test claim check on ' + name + ' and renew the cover for a second month.',
    },
  ];

  function kindFor(category) {
    const lower = (category || '').toLowerCase();
    for (const kind of PLAN_KINDS) {
      if (kind.keys.some((key) => lower.indexOf(key) >= 0)) return kind;
    }
    return null;
  }

  function mainAction(p, capital, chain) {
    const kind = kindFor(p.category);
    if (kind) return kind.main(p.name, capital, chain);
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }

  function secondAction(p, capital, chain) {
    const kind = kindFor(p.category);
    if (kind && kind.second) return kind.second(p.name, capital, chain);
    return 'Use ' + p.name + ' a second way on ' + chain + ': swap $' + halfStake(capital) + ' through it and deposit the result back in.';
  }

  function formatStep(step) {
    let text = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (text.length > 600) text = text.slice(0, 596) + '...';
    if (text.length < 20) text += " Hold the position and check the protocol's own page.";
    return text;
  }

  function farmSteps(p) {
    const chain = firstChain(p);
    const capital = stakeFor(p);
    const hold = holdFor(p.age_days);
    const gasMain = capital >= 150 ? 8 : 4;
    const gasSecond = capital >= 150 ? 5 : 3;
    const steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gasMain + ' of gas', time: '15 minutes to set up' },
      { text: secondAction(p, capital, chain), cost: 'about $' + gasSecond + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
    return steps.map(formatStep);
  }

  // --- URL hash: the search, the category and the open protocol survive a reload --------------
  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) view.query = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (view.query) params.set('q', view.query);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.selected) params.set('p', view.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // --- Filtering and sorting ------------------------------------------------------------------
  function visibleRows() {
    const q = view.query.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (view.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function valueForSort(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_days === null ? Infinity : row.age_days;
    return row.implied_value_usd;
  }

  function sortedRows(list) {
    const key = view.sortKey;
    const dir = view.sortDir;
    return list.slice().sort((a, b) => {
      const av = valueForSort(a, key);
      const bv = valueForSort(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });
  }

  function chainLabel(row) {
    if (row.chains && row.chains.length) return row.chains.slice(0, 2).join(', ');
    return 'an unnamed chain';
  }

  // --- Sections ---------------------------------------------------------------------------------
  function topBar() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function intro() {
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function filterControls() {
    const categories = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
    const chains = Array.from(new Set(DATA.rows.reduce((acc, r) => acc.concat(r.chains || []), []))).sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.query, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { view.query = search.value; writeHash(); render(); });
    const categorySelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }))
    );
    categorySelect.addEventListener('change', () => { view.category = categorySelect.value; writeHash(); render(); });
    const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => h('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }))
    );
    chainSelect.addEventListener('change', () => { view.chain = chainSelect.value; writeHash(); render(); });
    const watchlistButton = h('button', {
      type: 'button', class: 'button', 'aria-pressed': view.watchlistOnly ? 'true' : 'false',
      text: view.watchlistOnly ? 'Watchlist only: on' : 'Watchlist only',
      onclick: () => { view.watchlistOnly = !view.watchlistOnly; render(); },
    });
    const preTab = h('button', {
      type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token',
      onclick: () => { view.tab = 'pre-token'; render(); },
    });
    const liveTab = h('button', {
      type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token',
      onclick: () => { view.tab = 'live'; render(); },
    });
    const shown = view.tab === 'pre-token'
      ? visibleRows().length + ' rows shown'
      : DATA.live.length + ' live-token protocols';
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), categorySelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('label', { text: 'Scope' }), watchlistButton),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, preTab, liveTab)),
      h('span', { class: 'count', text: shown })
    );
  }

  function sortButton(key, label) {
    const active = view.sortKey === key;
    return h('th', { scope: 'col' },
      h('button', {
        type: 'button',
        onclick: () => {
          if (view.sortKey === key) view.sortDir = -view.sortDir;
          else { view.sortKey = key; view.sortDir = -1; }
          render();
        },
      },
        label,
        active ? h('span', { 'aria-hidden': 'true', text: view.sortDir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardRow(r, topValue) {
    const growthText = r.change_7d === null ? 'n/a' : pct(r.change_7d);
    const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    const barWidth = Math.max(3, Math.round((r.implied_value_usd / topValue) * 100));
    return h('tr', {
      'data-selected': view.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: () => openDetail(r.slug),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
    },
      h('td', { class: 'num', text: String(r.rank) }),
      h('td', null, h('div', { class: 'name' },
        h('b', { text: r.name }),
        h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
      )),
      h('td', { class: 'num', text: money(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growthText }),
      h('td', { class: 'num', text: ageText(r.age_days) }),
      h('td', null, h('div', { class: 'implied' },
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + barWidth + '%' })),
        h('span', { class: 'num', text: money(r.implied_value_usd) })
      )),
      h('td', null, h('span', { class: 'status' + (r.watchlist ? ' wl' : ''), text: r.watchlist ? 'watchlist' : 'early' }))
    );
  }

  function boardTable() {
    const list = sortedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { view.query = ''; view.category = 'all'; writeHash(); render(); } })
      ));
    }
    const topValue = list[0].implied_value_usd || 1;
    const tbody = h('tbody');
    list.forEach((r) => tbody.appendChild(boardRow(r, topValue)));
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortButton('implied', 'Rank'),
            sortButton('name', 'Protocol'),
            sortButton('tvl', 'TVL'),
            sortButton('growth', '7d'),
            sortButton('age', 'Age'),
            sortButton('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    const tbody = h('tbody');
    DATA.live.forEach((r) => {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Status' }),
            h('th', { scope: 'col', text: 'Protocol' }),
            h('th', { scope: 'col', text: 'TVL' }),
            h('th', { scope: 'col', text: '7d' }),
            h('th', { scope: 'col', text: 'Market cap' }),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    const m = DATA.model;
    const formula = 'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_cap + ')) )';
    const ceiling = (1 + m.chain_step * m.chain_cap).toFixed(2);
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' }, formula),
      h('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The chain factor credits a protocol for being live on more chains, capped at ' + ceiling + 'x. The early radar is every pre-token protocol below the watchlist floor that passes the wrapped/staked exclusion, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { view.selected = null; writeHash(); });

  function openDetail(slug) {
    const row = DATA.rows.filter((r) => r.slug === slug)[0];
    if (!row) return;
    view.selected = slug;
    writeHash();
    dialog.textContent = '';
    const steps = farmSteps(row);
    const recomputed = recomputeImplied(row, DATA.model);
    const checkNote = recomputed === row.implied_value_usd
      ? ', the same number board.json carries.'
      : ', which differs from the board: the data would be stale.';
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() })
    ));
    const equationRows = [
      ['TVL', money(row.tvl_usd)],
      ['Seven-day growth', pct(row.change_7d)],
      ['Age with no token', ageText(row.age_days)],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Chain multiplier (' + (row.chains || []).length + ' chains)', String(row.chain_multiplier)],
      ['Implied value', money(row.implied_value_usd)],
    ];
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        equationRows.map(([label, value]) => h('div', null, h('span', { text: label }), h('b', { class: 'num', text: value })))
      ),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + checkNote + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    mount.textContent = '';
    const shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filterControls());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    if (view.tab === 'pre-token') shell.appendChild(modelPanel());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
