(() => {
  'use strict';
  const app = document.getElementById('app');
  const SRC = 'https://www.othello.gr.jp/rate/rate_tournaments/';
  const PLAYER = 'https://www.othello.gr.jp/rate/rate_players/';
  const EVENTS = { '名人戦': ['期', 'オセロ名人戦'], '全日本': ['回', '全日本オセロ選手権'], '王座戦': ['期', 'オセロ王座戦'] };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const title = t => `第${t.edition}${EVENTS[t.event][0]} ${EVENTS[t.event][1]}`;
  const ymd = d => d.replace(/-/g, '.');
  const getJson = p => fetch(p).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const ls = {
    get(k) { try { return localStorage.getItem('othello-results:' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('othello-results:' + k, v); } catch (e) {} }
  };

  let INDEX = null, DATA = null;
  const cache = {};

  /* ---------------- トップ：大会一覧 ---------------- */
  const home = { ev: ls.get('ev') || 'all', q: '' };

  function groups() {
    const map = new Map();
    for (const t of INDEX) {
      const k = t.event + t.edition;
      if (!map.has(k)) map.set(k, { key: k, event: t.event, edition: t.edition, date: t.date, items: [] });
      const g = map.get(k);
      g.items.push(t);
      if (t.date > g.date) g.date = t.date;
    }
    const order = d => /無差別|本戦|^A$|決定戦$|決勝/.test(d) && !/女/.test(d) ? 0 : /女/.test(d) ? 2 : 1;
    for (const g of map.values()) g.items.sort((a, b) => order(a.division) - order(b.division) || b.count - a.count);
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  function renderHome() {
    document.title = 'オセロ棋戦結果';
    const chip = (v, l) => `<button class="chip" data-ev="${v}" aria-pressed="${home.ev === v}">${l}</button>`;
    app.innerHTML = `
      <header>
        <div class="eyebrow">名人戦 ・ 全日本選手権 ・ 王座戦</div>
        <h1>オセロ棋戦結果</h1>
        <div class="meta">${INDEX.length}大会（${INDEX[INDEX.length - 1].date.slice(0, 4)}〜${INDEX[0].date.slice(0, 4)}年）の順位と全対局。
          データは<a href="https://www.othello.gr.jp/rate/rate_tournaments" target="_blank" rel="noopener">日本オセロ連盟レーティング</a>から。</div>
      </header>
      <div class="tools">
        <input type="search" id="hq" placeholder="大会名・1位の選手名・年で検索（例：2019、高梨）" value="${esc(home.q)}" aria-label="大会を検索">
        <div class="chips">${chip('all', 'すべて')}${chip('名人戦', '名人戦')}${chip('全日本', '全日本選手権')}${chip('王座戦', '王座戦')}</div>
      </div>
      <div class="cards" id="cards"></div>
      <footer>各大会の順位は、日本オセロ連盟レーティングの大会ページの掲載順です。</footer>`;
    app.querySelector('#hq').addEventListener('input', e => { home.q = e.target.value; renderCards(); });
    app.querySelectorAll('[data-ev]').forEach(b => b.addEventListener('click', () => {
      home.ev = b.dataset.ev; ls.set('ev', home.ev);
      app.querySelectorAll('[data-ev]').forEach(x => x.setAttribute('aria-pressed', x === b));
      renderCards();
    }));
    renderCards();
  }

  function renderCards() {
    const q = home.q.trim().toLowerCase();
    const list = groups().filter(g => (home.ev === 'all' || g.event === home.ev) &&
      (!q || [title(g), g.date, ...g.items.flatMap(t => [t.name, t.division, t.winner])].join(' ').toLowerCase().includes(q)));
    let h = '', year = '';
    for (const g of list) {
      const y = g.date.slice(0, 4);
      if (y !== year) { h += `<div class="year">${y}</div>`; year = y; }
      h += `<section class="card"><div class="hd"><b><span class="ev">${esc(g.event === '全日本' ? '全日本' : g.event)}</span>${esc(title(g))}</b><span>${ymd(g.items[g.items.length - 1].date)}</span></div>
        ${g.items.map(t => `<a class="div" href="#/t/${t.id}">
          <span class="dn">${esc(t.division)}<small>${t.count}名・${t.rounds}回戦</small></span>
          <span class="w1"><em>1位</em>${esc(t.winner)}</span></a>`).join('')}</section>`;
    }
    document.getElementById('cards').innerHTML = h || '<p class="empty">該当する大会がありません。</p>';
  }

  /* ---------------- 大会ページ ---------------- */
  let T = null; // 表示中の大会
  const view = { tab: 'stand', q: '', wins: 'all', round: 1, open: new Set() };

  function prep(t) {
    // players: [rank, name, abbr, region, dan, pid, rate, games]  games[r]: [結果, 石数|null, 相手の番号] か 0
    t.P = t.players.map((p, i) => {
      const games = p[7].map(g => g ? { res: g[0], st: g[1], opp: g[2] } : null);
      const w = games.filter(g => g && g.res === '○').length;
      const l = games.filter(g => g && g.res === '×').length;
      const d = games.filter(g => g && g.res === '△').length;
      return { i, rank: p[0], name: p[1], abbr: p[2], region: p[3], dan: p[4], pid: p[5], rate: p[6], games, w, l, d, score: w + d / 2 };
    });
    return t;
  }

  const wl = p => `${p.w}勝${p.l}敗${p.d ? p.d + '分' : ''}`;
  const sub = p => [p.dan, p.region].filter(Boolean).join('・');
  const line = p => [sub(p), wl(p)].filter(Boolean).join(' ・ ');
  const discs = p => `<div class="discs" aria-hidden="true">${p.games.map(g => `<span class="d${!g ? ' n' : g.res === '○' ? ' w' : g.res === '△' ? ' h' : ''}"></span>`).join('')}</div>`;
  const oppOf = g => typeof g.opp === 'number' ? T.P[g.opp] : null;
  function opponentStones(p, r) {
    const g = p.games[r]; const o = oppOf(g);
    const og = o && o.games[r];
    return og && og.st != null ? og.st : null;
  }

  async function renderTournament(id) {
    app.innerHTML = '<p class="empty">読み込み中…</p>';
    if (!cache[id]) cache[id] = prep(DATA.t[id]);
    if (!T || T.id !== id) { view.tab = 'stand'; view.q = ''; view.wins = 'all'; view.round = 1; view.open = new Set(); }
    T = cache[id];
    document.title = `${title(T)} ${T.division === '本戦' ? '' : T.division} 結果`;
    const sibs = INDEX.filter(x => x.event === T.event && x.edition === T.edition).sort((a, b) => a.id - b.id);
    const P = T.P;
    const top = P.slice(0, 3);
    const yearsHint = T.hasStones ? '' : '・石数の記録なし';
    app.innerHTML = `
      <header>
        <div class="eyebrow"><a href="#/">← 大会一覧</a> ・ ${ymd(T.date)}</div>
        <h1>${esc(title(T))}${T.division !== '本戦' ? `<br><span style="font-size:.7em">${esc(T.division)}</span>` : ''}</h1>
        <div class="meta">${P.length}名参加 ・ ${T.rounds}回戦${yearsHint} ・ <a href="${SRC}${T.id}" target="_blank" rel="noopener">連盟レーティングの元ページ</a></div>
      </header>
      ${sibs.length > 1 ? `<nav class="sib" aria-label="同じ大会のほかの部門">${sibs.map(s => `<a href="#/t/${s.id}" ${s.id === T.id ? 'aria-current="page"' : ''}>${esc(s.division)}</a>`).join('')}</nav>` : ''}
      ${top.length ? `<section class="final">
        <div class="ttl"><h2>1位</h2><span>${P.length}名中</span></div>
        <div class="champ"><span class="nm">${esc(top[0].name)}</span><span class="sub">${esc(line(top[0]))}</span>${discs(top[0])}</div>
        ${top.length > 1 ? `<div class="podium">${top.slice(1).map((p, k) => `<div><span class="pl">${k + 2}位</span><span class="nm">${esc(p.name)}</span><span class="sub">${esc(line(p))}</span></div>`).join('')}</div>` : ''}
      </section>` : ''}
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="stand" aria-selected="${view.tab === 'stand'}">順位表</button>
        <button role="tab" data-tab="games" aria-selected="${view.tab === 'games'}">対局表</button>
      </div>
      <div id="body"></div>
      <footer>出典：<a href="${SRC}${T.id}" target="_blank" rel="noopener">日本オセロ連盟レーティング「${esc(T.name)}」</a>。順位は元ページの掲載順。名前をタップすると全対局が見られます。</footer>`;
    app.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      view.tab = b.dataset.tab;
      app.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
      renderBody();
    }));
    renderBody();
    window.scrollTo(0, 0);
  }

  function renderBody() {
    const body = document.getElementById('body');
    if (view.tab === 'stand') renderStand(body); else renderGames(body);
  }

  function renderStand(body) {
    const scores = [...new Set(T.P.map(p => p.score))].sort((a, b) => b - a);
    const chip = (v, l) => `<button class="chip" data-w="${v}" aria-pressed="${String(view.wins) === String(v)}">${l}</button>`;
    body.innerHTML = `<div class="tools">
        <input type="search" id="sq" placeholder="名前・地区・段位で検索（例：近畿、七段）" value="${esc(view.q)}" aria-label="選手を検索">
        <div class="chips">${chip('all', '全員')}${scores.slice(0, 6).map(s => chip(s, s + '勝')).join('')}</div>
      </div>
      <div class="list" id="list" style="margin-top:14px"></div>`;
    body.querySelector('#sq').addEventListener('input', e => { view.q = e.target.value; renderList(); });
    body.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => {
      view.wins = b.dataset.w === 'all' ? 'all' : +b.dataset.w;
      body.querySelectorAll('[data-w]').forEach(x => x.setAttribute('aria-pressed', x === b));
      renderList();
    }));
    renderList();
  }

  function renderList() {
    const q = view.q.trim().toLowerCase();
    const list = T.P.filter(p => (view.wins === 'all' || p.score === view.wins) &&
      (!q || [p.name, p.region, p.dan, p.abbr].join(' ').toLowerCase().includes(q)));
    let h = '', last = null;
    for (const p of list) {
      if (p.score !== last) { h += `<div class="grouphead">${p.score}勝</div>`; last = p.score; }
      const open = view.open.has(p.i);
      h += `<div class="row" role="button" tabindex="0" aria-expanded="${open}" data-p="${p.i}">
          <span class="rk num${p.rank && p.rank <= 3 ? ' top' : ''}">${p.rank ?? ''}</span>
          <span class="who"><div class="nm">${esc(p.name)}</div><div class="sub">${esc(sub(p))}</div></span>
          <span class="right"><span class="wl num">${wl(p)}</span>${discs(p)}</span>
        </div>${open ? detail(p) : ''}`;
    }
    const el = document.getElementById('list');
    el.innerHTML = h || '<p class="empty">該当する選手がいません。</p>';
    el.querySelectorAll('.row').forEach(r => {
      const toggle = () => { const i = +r.dataset.p; view.open.has(i) ? view.open.delete(i) : view.open.add(i); renderList(); };
      r.addEventListener('click', toggle);
      r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    el.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const i = +b.dataset.jump; view.open.add(i); view.q = ''; view.wins = 'all';
      renderStand(document.getElementById('body'));
      const row = document.querySelector(`.row[data-p="${i}"]`);
      if (row) { row.scrollIntoView({ block: 'center' }); row.focus({ preventScroll: true }); }
    }));
  }

  function detail(p) {
    const rows = p.games.map((g, r) => {
      if (!g) return `<tr><td class="r">${r + 1}回戦</td><td class="res">−</td><td colspan="2" style="color:var(--muted)">対局なし</td></tr>`;
      const o = oppOf(g);
      const os = opponentStones(p, r);
      const sc = g.st != null ? `${g.st}−${os ?? '?'}` : '';
      return `<tr><td class="r">${r + 1}回戦</td><td class="res${g.res === '○' ? ' w' : ''}">${g.res}</td>
        <td>${o ? `<button class="link" data-jump="${o.i}">${esc(o.name)}</button> <span style="color:var(--muted);font-size:12px">${o.rank ? o.rank + '位・' : ''}${wl(o)}</span>` : esc(g.opp)}</td>
        <td class="sc num">${sc}</td></tr>`;
    }).join('');
    let rate = '';
    if (p.rate) {
      const diff = p.rate[1] - p.rate[0];
      rate = `<span>レート ${p.rate[0]}→${p.rate[1]}（<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff}</span>）</span>`;
    }
    return `<div class="detail"><table>${rows}</table>
      <div class="sum">${rate}${p.pid ? `<a href="${PLAYER}${p.pid}" target="_blank" rel="noopener">連盟レーティングの選手ページ</a>` : ''}</div></div>`;
  }

  function renderGames(body) {
    if (view.round > T.rounds) view.round = 1;
    body.innerHTML = `<div class="tools"><div class="chips">${Array.from({ length: T.rounds }, (_, i) =>
      `<button class="chip" data-r="${i + 1}" aria-pressed="${view.round === i + 1}">${i + 1}回戦</button>`).join('')}</div></div>
      <div class="games" id="games" style="margin-top:14px"></div>`;
    body.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
      view.round = +b.dataset.r;
      body.querySelectorAll('[data-r]').forEach(x => x.setAttribute('aria-pressed', x === b));
      renderPairs();
    }));
    renderPairs();
  }

  function renderPairs() {
    const r = view.round - 1;
    const seen = new Set(), pairs = [];
    for (const p of T.P) {
      const g = p.games[r];
      if (!g || seen.has(p.i)) continue;
      const o = oppOf(g);
      seen.add(p.i); if (o) seen.add(o.i);
      // 勝った側を左に
      if (o && g.res === '×') pairs.push([o, p]); else pairs.push([p, o]);
    }
    pairs.sort((a, b) => (a[0].rank ?? 1e9) - (b[0].rank ?? 1e9));
    const side = (p, lose, right) => p
      ? `<div class="side${right ? ' r' : ''}"><span class="nm${lose ? ' lose' : ''}">${esc(p.name)}</span><span class="sub">${esc(sub(p))}${p.rank ? '・' + p.rank + '位' : ''}</span></div>`
      : `<div class="side${right ? ' r' : ''}"><span class="nm lose">不明</span></div>`;
    const h = pairs.map(([a, b], k) => {
      const ga = a.games[r];
      const draw = ga.res === '△';
      const sb = b ? b.games[r] : null;
      const score = ga.st != null
        ? `<span>${ga.st}</span><span class="dash">−</span><span class="l">${sb && sb.st != null ? sb.st : '?'}</span>`
        : `<span class="mark">${draw ? '△' : '○'}</span><span class="dash">−</span><span class="l mark">${draw ? '△' : '×'}</span>`;
      return `<div class="game"><span class="no num">${k + 1}</span>${side(a, false, false)}<span class="score num">${score}</span>${side(b, !draw, true)}</div>`;
    }).join('');
    document.getElementById('games').innerHTML = h || '<p class="empty">この回戦の対局はありません。</p>';
  }

  /* ---------------- 画面の切り替え ---------------- */
  async function route() {
    try {
      if (!DATA) { DATA = await getJson('results.json'); INDEX = DATA.index; }
      const m = location.hash.match(/^#\/t\/(\d+)/);
      if (m && INDEX.some(t => t.id === +m[1])) await renderTournament(+m[1]);
      else { T = null; renderHome(); }
    } catch (e) {
      app.innerHTML = '<p class="empty">データを読み込めませんでした。ページを再読み込みしてください。</p>';
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
