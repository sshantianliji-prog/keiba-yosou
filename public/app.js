// ---------- 基本 ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => `${Number(n || 0).toLocaleString('ja-JP')}円`;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  chev: '<svg viewBox="0 0 24 24" class="chev"><path d="m9 6 6 6-6 6"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
};
const COURSES = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
const STATUS = {
  new: ['未読み取り', ''], read: ['読み取り済み', 'orange'], confirmed: ['確認済み', 'blue'],
  researched: ['リサーチ済み', 'indigo'], predicted: ['予想済み', 'blue'], settled: ['結果入力済み', 'green'],
};
let META = { betTypes: {}, viewpoints: [] };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    location.hash = '#/login';
    throw new Error(data.error || 'ログインしてください');
  }
  if (!res.ok) throw new Error(data.error || `エラーが発生しました（${res.status}）`);
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast glass ${type}`;
  el.textContent = msg;
  el.setAttribute('data-testid', type === 'err' ? 'toast-error' : 'toast');
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, type === 'err' ? 4200 : 2400);
}

async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try { return await fn(); }
  catch (e) { toast(e.message, 'err'); throw e; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('loading'); } }
}

// ---------- スケルトン ----------
const skel = $('#skeleton');
const skLines = (n, widths = []) => Array.from({ length: n }, (_, i) => `<span class="sk sk-line" style="width:${widths[i] || 60 + ((i * 17) % 35)}%"></span>`).join('');
const SK = {
  list: () => `<div class="sk-card">${Array.from({ length: 6 }, () => `<div class="sk-li"><span class="sk sk-sq"></span><div class="sk-lines">${skLines(2, [55, 35])}</div></div>`).join('')}</div>`,
  detail: () => `<span class="sk" style="height:40px;border-radius:999px;margin-bottom:16px"></span><div class="sk-card">${skLines(3)}<span class="sk" style="height:150px;margin-top:14px;border-radius:18px"></span></div><div class="sk-card">${skLines(5)}</div>`,
  stats: () => `<div class="grid4" style="margin-bottom:14px">${Array.from({ length: 4 }, () => `<div class="sk-card">${skLines(2, [40, 70])}</div>`).join('')}</div><div class="sk-card">${skLines(8)}</div>`,
  rules: () => `<div class="sk-card">${skLines(12)}</div>`,
  login: () => `<div style="display:grid;place-items:center;min-height:60vh"><div class="sk-card" style="width:min(380px,100%)"><span class="sk" style="width:64px;height:64px;border-radius:18px;margin:0 auto 14px"></span>${skLines(1, [50])}<span class="sk" style="height:44px;margin-top:16px"></span><span class="sk" style="height:44px;margin-top:12px;border-radius:999px"></span></div></div>`,
};
function showSkeleton(kind) {
  $('.sk-body', skel).innerHTML = SK[kind]();
  $('.sk-head', skel).style.display = kind === 'login' ? 'none' : '';
  $('.sk-tabbar', skel).style.display = kind === 'login' ? 'none' : '';
  skel.classList.remove('hide');
  skel.setAttribute('aria-busy', 'true');
}
function hideSkeleton() {
  skel.classList.add('hide');
  skel.setAttribute('aria-busy', 'false');
}
const inlineSkeleton = (label, lines = 6) =>
  `<div class="card glass sk-inline" data-testid="ai-loading"><div class="ai-status"><span class="orb"></span>${esc(label)}</div>${skLines(lines)}<span class="sk" style="height:90px;margin-top:12px;border-radius:16px"></span></div>`;

// ---------- 光の反射（ポインタ追従） ----------
document.addEventListener('pointermove', (e) => {
  const g = e.target.closest?.('.glass');
  if (!g) return;
  const r = g.getBoundingClientRect();
  g.style.setProperty('--mx', `${e.clientX - r.left}px`);
  g.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest?.('.btn');
  if (!b || reduced) return;
  const r = b.getBoundingClientRect();
  const s = Math.max(r.width, r.height);
  const i = document.createElement('span');
  i.className = 'ripple';
  i.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.append(i);
  setTimeout(() => i.remove(), 700);
});

// ---------- ナビ ----------
function pageHeader(title, { back, actions = '', sub = '' } = {}) {
  const navActions = actions.replace(/\sdata-testid="[^"]*"/g, '');
  return `
  <div class="navbar glass">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="戻る">${ICON.back}</a>` : '<span style="width:40px"></span>'}
    <div class="nb-title">${esc(title)}</div>
    <div class="row">${navActions || '<span style="width:40px"></span>'}</div>
  </div>
  <div class="large-title">
    <div>${back ? `<a class="btn plain small" href="${back}" style="margin-left:-12px">${ICON.back}戻る</a>` : ''}<h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div class="row">${actions}</div>
  </div>`;
}
let scrollBound = false;
function bindScroll() {
  if (scrollBound) return;
  scrollBound = true;
  addEventListener('scroll', () => {
    const nb = $('.navbar', app);
    const h1 = $('.large-title h1', app);
    if (!nb || !h1) return;
    const y = scrollY;
    nb.classList.toggle('show', y > 60);
    const s = Math.max(0.86, 1 - y / 600);
    h1.style.transform = `scale(${s})`;
    h1.style.opacity = String(Math.max(0, 1 - y / 90));
  }, { passive: true });
}

function setTab(name) {
  const bar = $('#tabbar');
  bar.hidden = !name;
  if (!name) return;
  const links = $$('a', bar);
  const idx = Math.max(0, links.findIndex((a) => a.dataset.tab === name));
  links.forEach((a, i) => a.classList.toggle('active', i === idx));
  const w = links[0].offsetWidth + 2;
  $('.tab-thumb', bar).style.transform = `translateX(${idx * w}px)`;
}

function render(html, after) {
  const apply = () => {
    app.innerHTML = html;
    scrollTo({ top: 0 });
    after?.();
  };
  if (document.startViewTransition && !reduced) document.startViewTransition(apply);
  else apply();
}

// ---------- ルーター ----------
async function route() {
  const h = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [, a, b] = h.split('/');
  try {
    if (a === 'login') return await viewLogin();
    if (!META.viewpoints.length) META = await api('/api/me');
    if (!a) return await viewRaces();
    if (a === 'race' && b) return await viewRace(decodeURIComponent(b));
    if (a === 'stats') return await viewStats();
    if (a === 'rules') return await viewRules();
    location.hash = '#/';
  } catch (e) {
    hideSkeleton();
    if (!/ログイン/.test(e.message)) {
      render(`${pageHeader('エラー', { back: '#/' })}<div class="card glass"><div class="banner err">${esc(e.message)}</div></div>`);
    }
  }
}
addEventListener('hashchange', route);

// ---------- ログイン ----------
async function viewLogin() {
  showSkeleton('login');
  setTab(null);
  render(`
  <div class="login-wrap">
    <form class="login glass reveal" data-testid="login-form">
      <img class="logo" src="/icon.svg" alt="">
      <h1>競馬予想</h1>
      <input class="input" type="password" name="password" placeholder="パスコード" autocomplete="current-password" required data-testid="password">
      <button class="btn wide" type="submit" data-testid="login-submit">ログイン</button>
    </form>
  </div>`, () => {
    const f = $('form', app);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button', f);
      try {
        await busy(btn, () => api('/api/login', { method: 'POST', body: { password: f.password.value } }));
        location.hash = '#/';
      } catch {
        f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      }
    });
    setTimeout(() => f.password.focus(), 300);
  });
  setTimeout(hideSkeleton, 120);
}

// ---------- レース一覧 ----------
async function viewRaces() {
  showSkeleton('list');
  setTab('races');
  const { races } = await api('/api/races');
  const items = races.map((r, i) => {
    const [label, color] = STATUS[r.status] || ['', ''];
    const res = r.status === 'settled' ? `<span class="chip ${r.hit ? 'green' : ''}">${r.hit ? '的中' : '不的中'}</span>` : `<span class="chip ${color}">${label}</span>`;
    return `<a class="list-item reveal" style="--i:${i}" href="#/race/${encodeURIComponent(r.id)}" data-testid="race-item" data-id="${esc(r.id)}">
      <span class="badge-r">${r.rnum}R</span>
      <div class="li-main"><div class="li-title">${esc(r.course)} ${r.rnum}R ${esc(r.race_name || '')}</div><div class="li-sub">${esc(r.date)}</div></div>
      ${res}${ICON.chev}</a>`;
  }).join('');
  render(`
    ${pageHeader('レース', { actions: `<button class="icon-btn" data-act="new" aria-label="新規レース" data-testid="new-race">${ICON.plus}</button><button class="icon-btn" data-act="logout" aria-label="ログアウト" data-testid="logout">${ICON.out}</button>` })}
    ${races.length ? `<div class="list glass reveal" data-testid="race-list">${items}</div>` : `<div class="card glass reveal muted" style="text-align:center">レースがありません</div>`}
  `, () => {
    $$('[data-act="new"]', app).forEach((b) => b.addEventListener('click', newRaceSheet));
    $$('[data-act="logout"]', app).forEach((b) => b.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.hash = '#/login'; }));
  });
  hideSkeleton();
}

function sheet(html, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  const close = () => {
    $('.sheet', root)?.classList.add('closing');
    $('.sheet-backdrop', root)?.classList.add('closing');
    setTimeout(() => (root.innerHTML = ''), 340);
  };
  $('.sheet-backdrop', root).addEventListener('click', close);
  addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); removeEventListener('keydown', k); } });
  onMount($('.sheet', root), close);
}

function newRaceSheet() {
  const d = new Date();
  const dow = d.getDay();
  const add = dow === 6 || dow === 0 ? 0 : 6 - dow;
  const sat = new Date(d.getTime() + add * 864e5);
  const iso = new Date(sat.getTime() - sat.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  sheet(`
    <h2>新規レース</h2>
    <form class="grid" style="display:grid;gap:14px" data-testid="new-race-form">
      <label class="field"><span>日付</span><input class="input" type="date" name="date" value="${iso}" required data-testid="nr-date"></label>
      <label class="field"><span>競馬場</span><select class="input" name="course" data-testid="nr-course">${COURSES.map((c) => `<option ${c === '東京' ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>R番号</span><select class="input" name="rnum" data-testid="nr-rnum">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i === 10 ? 'selected' : ''}>${i + 1}R</option>`).join('')}</select></label>
      <div class="row" style="margin-top:6px"><button type="button" class="btn secondary" data-close style="flex:1">キャンセル</button><button class="btn" style="flex:1" data-testid="nr-submit">作成</button></div>
    </form>`, (el, close) => {
    $('[data-close]', el).addEventListener('click', close);
    $('form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const r = await busy($('[data-testid="nr-submit"]', el), () => api('/api/races', { method: 'POST', body: { date: f.date.value, course: f.course.value, rnum: Number(f.rnum.value) } }));
      if (r.existed) toast('同じレースが既にあるため開きます');
      close();
      location.hash = `#/race/${encodeURIComponent(r.id)}`;
    });
  });
}

// ---------- レース詳細 ----------
const STEPS = [
  ['read', '読み取り'], ['check', '確認'], ['research', 'リサーチ'], ['yosou', '予想'], ['kekka', '結果'],
];
const state = { race: null, step: 'read', prevIdx: 0 };

function stepDone(race, key) {
  return {
    read: !!race.horses,
    check: !!race.horses?.confirmed,
    research: !!race.research,
    yosou: !!race.yosou,
    kekka: !!race.kekka,
  }[key];
}
function defaultStep(race) {
  if (race.kekka || race.yosou) return race.kekka ? 'kekka' : 'yosou';
  if (race.research) return 'yosou';
  if (race.horses?.confirmed) return 'research';
  if (race.horses) return 'check';
  return 'read';
}

async function viewRace(id) {
  showSkeleton('detail');
  setTab('races');
  const { race } = await api(`/api/races/${encodeURIComponent(id)}`);
  state.race = race;
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('step');
  state.step = STEPS.some(([k]) => k === want) ? want : defaultStep(race);
  const info = race.horses?.race || {};
  const sub = [race.date, info.クラス, info.芝ダ && info.距離 ? `${info.芝ダ}${info.距離}m` : '', info.回り && info.回り !== 'なし' ? info.回り : ''].filter(Boolean).map(esc).join('・');
  render(`
    ${pageHeader(`${race.course} ${race.rnum}R ${race.race_name || ''}`.trim(), {
      back: '#/', sub,
      actions: `<button class="icon-btn" data-act="del" aria-label="削除" data-testid="delete-race" style="color:var(--red)">${ICON.trash}</button>`,
    })}
    <div class="segmented reveal" role="tablist" data-testid="steps"><span class="thumb"></span>
      ${STEPS.map(([k, l]) => `<button role="tab" data-step="${k}" data-testid="step-${k}" class="${stepDone(race, k) ? 'done' : ''}"><span class="dot"></span>${l}</button>`).join('')}
    </div>
    <div id="panel" style="margin-top:16px"></div>
  `, () => {
    $$('[data-step]', app).forEach((b) => b.addEventListener('click', () => goStep(b.dataset.step)));
    $$('[data-act="del"]', app).forEach((b) => b.addEventListener('click', () => confirmDelete(race)));
    goStep(state.step, true);
    addEventListener('resize', moveThumb);
  });
  hideSkeleton();
}

function moveThumb() {
  const seg = $('.segmented', app);
  if (!seg) return;
  const b = $(`[data-step="${state.step}"]`, seg);
  if (!b) return;
  const t = $('.thumb', seg);
  t.style.width = `${b.offsetWidth}px`;
  t.style.height = `${b.offsetHeight}px`;
  t.style.top = `${b.offsetTop}px`;
  t.style.transform = `translateX(${b.offsetLeft}px)`;
  b.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}

function refreshSteps() {
  $$('[data-step]', app).forEach((b) => b.classList.toggle('done', stepDone(state.race, b.dataset.step)));
}

function goStep(step, first = false) {
  const idx = STEPS.findIndex(([k]) => k === step);
  const dir = idx >= state.prevIdx ? 1 : -1;
  state.prevIdx = idx;
  state.step = step;
  $$('[data-step]', app).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.step === step)));
  requestAnimationFrame(moveThumb);
  const panel = $('#panel', app);
  panel.style.setProperty('--dir', first ? 0 : dir);
  panel.classList.remove('panel-enter'); void panel.offsetWidth; panel.classList.add('panel-enter');
  ({ read: panelRead, check: panelCheck, research: panelResearch, yosou: panelYosou, kekka: panelKekka })[step](panel);
  history.replaceState(null, '', `#/race/${encodeURIComponent(state.race.id)}?step=${step}`);
}

function confirmDelete(race) {
  sheet(`<h2>レースを削除</h2><p class="muted" style="text-align:center">${esc(race.id)} の画像・予想・成績記録をすべて削除します。元に戻せません。</p>
    <div class="row"><button class="btn secondary" data-close style="flex:1">キャンセル</button><button class="btn danger" data-ok style="flex:1" data-testid="confirm-delete">削除</button></div>`, (el, close) => {
    $('[data-close]', el).addEventListener('click', close);
    $('[data-ok]', el).addEventListener('click', async (e) => {
      await busy(e.currentTarget, () => api(`/api/races/${encodeURIComponent(race.id)}`, { method: 'DELETE' }));
      close();
      toast('削除しました');
      location.hash = '#/';
    });
  });
}

// --- 1. 読み取り ---
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 2000;
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

function panelRead(panel) {
  const race = state.race;
  const h = race.horses;
  const thumbs = () => race.images.map((im) => `<div class="thumb"><img loading="lazy" src="/api/races/${encodeURIComponent(race.id)}/images/${encodeURIComponent(im.key)}" alt="${esc(im.name)}"><button data-del="${esc(im.key)}" aria-label="画像を削除">${ICON.x}</button></div>`).join('');
  panel.innerHTML = `
    <div class="card glass reveal">
      <h2>出馬表の画像</h2>
      <label class="drop" data-testid="dropzone">${ICON.photo}<span>画像を選択またはドロップ</span><span class="small muted">JRA公式サイトの出馬表のスクリーンショット（最大8枚）</span>
        <input type="file" accept="image/*" multiple hidden data-testid="file-input"></label>
      <div class="thumbs" data-testid="thumbs">${thumbs()}</div>
      <h3>テキストで入力（任意）</h3>
      <textarea class="input" id="pasteText" placeholder="出馬表ページの文字をコピーして貼り付けると、画像より正確に読み取れます" data-testid="paste-text"></textarea>
      <div class="row end" style="margin-top:14px">
        ${h ? '<label class="row small muted"><input type="checkbox" id="resetRead"> 既存の読み取り結果を破棄する</label><span class="spacer"></span>' : ''}
        <button class="btn" id="doRead" data-testid="do-read">読み取る</button>
      </div>
    </div>
    <div id="readOut" style="margin-top:14px">${h ? readSummary(h) : ''}</div>`;
  const input = $('input[type=file]', panel);
  const drop = $('.drop', panel);
  const upload = async (files) => {
    for (const f of [...files].filter((f) => f.type.startsWith('image/'))) {
      try {
        const dataUrl = await resizeImage(f);
        const r = await api(`/api/races/${encodeURIComponent(race.id)}/images`, { method: 'POST', body: { dataUrl, name: f.name } });
        race.images = r.images;
        $('.thumbs', panel).innerHTML = thumbs();
      } catch (e) { toast(e.message, 'err'); }
    }
  };
  input.addEventListener('change', () => upload(input.files));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => upload(e.dataTransfer.files));
  $('.thumbs', panel).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    e.preventDefault();
    const r = await api(`/api/races/${encodeURIComponent(race.id)}/images/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
    race.images = r.images;
    $('.thumbs', panel).innerHTML = thumbs();
  });
  $('#doRead', panel).addEventListener('click', async (e) => {
    const text = $('#pasteText', panel).value;
    if (!race.images.length && !text.trim()) return toast('画像またはテキストを入力してください', 'err');
    const out = $('#readOut', panel);
    out.innerHTML = inlineSkeleton('出馬表を読み取っています', 8);
    try {
      const r = await busy(e.currentTarget, () => api(`/api/races/${encodeURIComponent(race.id)}/read`, { method: 'POST', body: { text, reset: !!$('#resetRead', panel)?.checked } }));
      race.horses = r.horses;
      if (r.horses.race?.レース名 && !race.race_name) race.race_name = r.horses.race.レース名;
      out.innerHTML = readSummary(r.horses);
      refreshSteps();
    } catch { out.innerHTML = ''; }
  });
  $('#readOut', panel).addEventListener('click', (e) => { if (e.target.closest('[data-go-check]')) goStep('check'); });
}

function readSummary(h) {
  const parts = [];
  parts.push(`<div class="banner ok">${h.horses.length}頭を読み取りました。</div>`);
  if (h.missing?.length) parts.push(`<div class="banner warn" data-testid="missing">馬番 ${h.missing.join('・')} のデータが画像に写っていません。追加の画像をお願いいたします。</div>`);
  if (h.needsCheck?.length) parts.push(`<div class="banner warn" data-testid="needs-check">馬番 ${h.needsCheck.join('・')} に読み取りに自信がない値があります。「確認」で修正してください。</div>`);
  (h.errors || []).forEach((e) => parts.push(`<div class="banner err">${esc(e)}</div>`));
  return `<div class="card glass reveal" style="display:grid;gap:10px">${parts.join('')}<div class="row end"><button class="btn" data-go-check data-testid="go-check">確認へ進む</button></div></div>`;
}

// --- 2. 確認 ---
const RACE_FIELDS = [['レース名', 'text'], ['クラス', 'text'], ['芝ダ', 'text'], ['距離', 'number'], ['回り', 'text'], ['頭数', 'number'], ['発走時刻', 'text'], ['馬場状態', 'text']];
const HORSE_COLS = [['枠番', 'w-s', 'number'], ['馬番', 'w-s', 'number'], ['馬名', 'w-name', 'text'], ['性齢', 'w-s', 'text'], ['斤量', 'w-s', 'number'], ['騎手', 'w-m', 'text'], ['調教師', 'w-m', 'text'], ['単勝オッズ', 'w-s', 'number'], ['人気', 'w-s', 'number'], ['馬体重', 'w-s', 'number'], ['増減', 'w-s', 'number'], ['戦績', 'w-m', 'text']];
const PAST_COLS = ['日付', '競馬場', 'レース名', 'クラス', '距離', '馬場', '頭数', '人気', '着順', 'タイム', '通過順', '上がり3F', '着差', '相手'];

function panelCheck(panel) {
  const race = state.race;
  const h = race.horses;
  if (!h) { panel.innerHTML = `<div class="card glass reveal"><div class="banner info">先に「読み取り」を行ってください。</div></div>`; return; }
  const flag = (horse, k) => (horse.要確認項目 || []).includes(k) ? 'warn' : '';
  panel.innerHTML = `
    ${h.confirmed ? '<div class="banner ok reveal" style="margin-bottom:14px">確認済みです。修正した場合はもう一度「確認して次へ」を押してください。</div>' : ''}
    ${h.missing?.length ? `<div class="banner warn reveal" style="margin-bottom:14px">馬番 ${h.missing.join('・')} が足りません。「読み取り」で画像を追加してください。</div>` : ''}
    ${h.needsCheck?.length ? `<div class="banner warn reveal" style="margin-bottom:14px" data-testid="check-banner">オレンジ色の欄は読み取りに自信がない値です（馬番 ${h.needsCheck.join('・')}）。画像と見比べて修正してください。</div>` : ''}
    <div class="card glass reveal">
      <h2>レース情報</h2>
      <div class="grid4" id="raceForm">${RACE_FIELDS.map(([k, t]) => `<label class="field"><span>${k}</span><input class="input" data-k="${k}" type="${t}" value="${esc(h.race?.[k] ?? '')}"></label>`).join('')}</div>
    </div>
    <div class="card glass reveal" style="--i:1">
      <h2>出走馬</h2>
      <div class="table-wrap"><table data-testid="horse-table"><thead><tr>${HORSE_COLS.map(([k]) => `<th>${k}</th>`).join('')}<th>近走</th></tr></thead>
      <tbody>${h.horses.map((horse, i) => `
        <tr data-i="${i}">${HORSE_COLS.map(([k, w, t]) => `<td><input class="input ${w} ${flag(horse, k)}" data-k="${k}" type="${t === 'number' ? 'text' : 'text'}" inputmode="${t === 'number' ? 'decimal' : 'text'}" value="${esc(horse[k] ?? '')}"></td>`).join('')}
        <td><details class="past"><summary>${(horse.近走 || []).length}走 ▾</summary><div></div></details></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row end" style="margin-top:16px">
        <button class="btn secondary" id="saveH" data-testid="save-horses">保存</button>
        <button class="btn" id="confirmH" data-testid="confirm-horses">確認して次へ</button>
      </div>
    </div>`;
  // 近走の編集（開いたときに描画）
  $$('details.past', panel).forEach((d) => d.addEventListener('toggle', () => {
    if (!d.open || d.dataset.ready) return;
    d.dataset.ready = '1';
    const i = Number(d.closest('tr').dataset.i);
    const past = h.horses[i].近走 || [];
    const rows = [...past, ...Array.from({ length: Math.max(0, 4 - past.length) }, () => ({}))].slice(0, 4);
    $('div', d).innerHTML = `<table style="margin-top:6px"><thead><tr>${PAST_COLS.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r, j) => `<tr data-j="${j}">${PAST_COLS.map((c) => `<td><input class="input w-s" data-p="${c}" value="${esc(r[c] ?? '')}" style="width:${['レース名', '相手'].includes(c) ? 130 : c === '日付' ? 100 : 70}px"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }));
  const collect = () => {
    const raceInfo = { ...(h.race || {}) };
    $$('#raceForm input', panel).forEach((el) => { raceInfo[el.dataset.k] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value; });
    const horses = $$('tbody > tr[data-i]', panel).map((tr) => {
      const i = Number(tr.dataset.i);
      const base = { ...h.horses[i] };
      $$(':scope > td > input[data-k]', tr).forEach((el) => {
        const col = HORSE_COLS.find(([k]) => k === el.dataset.k);
        const v = el.value.trim();
        base[el.dataset.k] = col[2] === 'number' ? (v === '' ? null : Number(v.replace(/[^\d.\-]/g, ''))) : v;
      });
      const pastRows = $$('tr[data-j]', tr);
      if (pastRows.length) {
        base.近走 = pastRows.map((pr) => Object.fromEntries($$('input', pr).map((el) => [el.dataset.p, el.value.trim() === '' ? null : el.value.trim()])))
          .filter((r) => Object.values(r).some((v) => v != null));
      }
      return base;
    });
    return { race: raceInfo, horses };
  };
  const save = async (btn, confirm) => {
    const r = await busy(btn, () => api(`/api/races/${encodeURIComponent(race.id)}/horses`, { method: 'PUT', body: { ...collect(), confirm } }));
    race.horses = r.horses;
    if (r.horses.race?.レース名) race.race_name = r.horses.race.レース名;
    refreshSteps();
    return r;
  };
  $('#saveH', panel).addEventListener('click', async (e) => { await save(e.currentTarget, false); toast('保存しました'); panelCheck(panel); });
  $('#confirmH', panel).addEventListener('click', async (e) => { await save(e.currentTarget, true); toast('確認しました'); goStep('research'); });
}

// --- 3. リサーチ ---
function panelResearch(panel) {
  const race = state.race;
  if (!race.horses?.confirmed) { panel.innerHTML = `<div class="card glass reveal"><div class="banner info">先に「確認」で出走馬データを確定してください。</div></div>`; return; }
  const rs = race.research;
  panel.innerHTML = `
    <div class="card glass reveal">
      <h2>リサーチ</h2>
      <p class="small muted" style="margin-top:-6px">JRA公式のコース紹介ページは自動で読み込みます。ほかに参考にしたい無料公開の記事があれば、URLを1行に1つずつ入力してください（最大7件）。</p>
      <label class="field"><span>参考記事のURL</span><textarea class="input" id="urls" placeholder="https://..." data-testid="urls">${esc((rs?.sources || []).filter((s) => !/jra\.go\.jp\/facilities/.test(s.url)).map((s) => s.url).join('\n'))}</textarea></label>
      <label class="field" style="margin-top:12px"><span>当日の馬場メモ（任意）</span><input class="input" id="memo" placeholder="例：内が伸びている、前残りが多い" value="${esc(rs?.memo || '')}" data-testid="track-memo"></label>
      <div class="row end" style="margin-top:14px"><button class="btn" id="doRs" data-testid="do-research">リサーチする</button></div>
    </div>
    <div id="rsOut" style="margin-top:14px">${rs ? researchView(rs) : ''}</div>`;
  $('#doRs', panel).addEventListener('click', async (e) => {
    const urls = $('#urls', panel).value.split(/\s+/).filter((u) => /^https?:\/\//.test(u)).slice(0, 7);
    const out = $('#rsOut', panel);
    out.innerHTML = inlineSkeleton('公開記事を読んでいます', 7);
    try {
      const r = await busy(e.currentTarget, () => api(`/api/races/${encodeURIComponent(race.id)}/research`, { method: 'POST', body: { urls, memo: $('#memo', panel).value } }));
      race.research = r.research;
      out.innerHTML = researchView(r.research);
      refreshSteps();
    } catch { out.innerHTML = ''; }
  });
  $('#rsOut', panel).addEventListener('click', (e) => { if (e.target.closest('[data-go-yosou]')) goStep('yosou'); });
}

function researchView(rs) {
  return `
    ${rs.enough ? '' : '<div class="banner warn reveal" style="margin-bottom:14px" data-testid="research-thin">十分なデータが取れていません。予想の精度が下がるため、見送りも選択肢になります。</div>'}
    <div class="card glass reveal" data-testid="research-result">
      ${Object.entries(rs.sections).map(([k, v]) => `<h3>${esc(k)}</h3><ul class="clean">${v.map((x) => `<li class="${x === '取得できず' ? 'muted' : ''}">${esc(x)}</li>`).join('')}</ul>`).join('')}
      <h3>出典</h3>
      <ul class="clean src">${rs.sources.map((s) => s.ok ? `<li>[${s.n}] <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>` : `<li class="muted">取得できず：${esc(s.url)}（${esc(s.reason)}）</li>`).join('') || '<li class="muted">なし</li>'}</ul>
      <div class="row end" style="margin-top:14px"><button class="btn" data-go-yosou data-testid="go-yosou">予想へ進む</button></div>
    </div>`;
}

// --- 4. 予想 ---
function panelYosou(panel) {
  const race = state.race;
  if (!race.horses?.confirmed) { panel.innerHTML = `<div class="card glass reveal"><div class="banner info">先に「確認」で出走馬データを確定してください。</div></div>`; return; }
  const y = race.yosou;
  panel.innerHTML = `
    ${race.research ? '' : '<div class="banner warn reveal" style="margin-bottom:14px">リサーチがまだです。データ不足の状態で予想します。</div>'}
    <div class="card glass reveal">
      <h2>券種と予算</h2>
      <div class="grid2">
        <label class="field"><span>券種</span><select class="input" id="btype" data-testid="bet-type">${Object.entries(META.betTypes).map(([k, v]) => `<option value="${k}" ${(y?.type || 'sanrenpuku_1') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field"><span>予算（円）</span><div class="stepper"><button type="button" data-d="-100" aria-label="100円減らす">−</button><input id="budget" inputmode="numeric" value="${y?.budget || 600}" data-testid="budget"><button type="button" data-d="100" aria-label="100円増やす">＋</button></div></label>
        <label class="field"><span>相手の頭数</span><select class="input" id="pcount" data-testid="partner-count"><option value="">おまかせ</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join('')}</select></label>
      </div>
      <div class="row end" style="margin-top:14px"><button class="btn" id="doY" data-testid="do-yosou">${y ? '予想し直す' : '予想する'}</button></div>
    </div>
    <div id="yOut" style="margin-top:14px">${y ? yosouView(y) : ''}</div>`;
  $$('.stepper button', panel).forEach((b) => b.addEventListener('click', () => {
    const el = $('#budget', panel);
    el.value = Math.max(100, (Number(el.value) || 0) + Number(b.dataset.d));
  }));
  $('#doY', panel).addEventListener('click', async (e) => {
    const budget = Number($('#budget', panel).value);
    if (!Number.isInteger(budget) || budget < 100 || budget % 100) return toast('予算は100円単位で入力してください', 'err');
    const out = $('#yOut', panel);
    out.innerHTML = inlineSkeleton('全頭を評価しています', 10);
    try {
      const r = await busy(e.currentTarget, () => api(`/api/races/${encodeURIComponent(race.id)}/yosou`, { method: 'POST', body: { type: $('#btype', panel).value, budget, partnerCount: $('#pcount', panel).value || null } }));
      race.yosou = r.yosou;
      out.innerHTML = yosouView(r.yosou);
      refreshSteps();
    } catch { out.innerHTML = ''; }
  });
  $('#yOut', panel).addEventListener('click', (e) => {
    if (e.target.closest('[data-dl]')) download(`${race.id}_yosou.md`, race.yosou.markdown, 'text/markdown');
    if (e.target.closest('[data-go-kekka]')) goStep('kekka');
  });
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const horseName = (n) => state.race.horses.horses.find((h) => h.馬番 === Number(n))?.馬名 || '';
const ball = (n, i = 0) => `<span class="num-ball" style="--i:${i}" title="${esc(horseName(n))}">${esc(n)}</span>`;
const comboHTML = (type, c) => c.map((n) => ball(n)).join(type === 'sanrentan_1' ? '<span class="muted">→</span>' : '<span class="muted">-</span>');

function yosouView(y) {
  const t = y.展開 || {};
  const lanes = ['逃げ', '先行', '中団', '後方'].map((k) => `<div class="lane"><b>${k}</b><div class="lane-track">${(t[k] || []).map((n, i) => ball(n, i)).join('') || '<span class="small muted" style="padding-left:10px">-</span>'}</div></div>`).join('');
  return `
    ${y.データ不足 || y.見送り推奨 ? `<div class="banner warn reveal" style="margin-bottom:14px" data-testid="skip-warn">${y.見送り推奨 ? `見送りをおすすめします。${esc(y.見送り理由)}` : 'データが十分に取れていません。見送りも選択肢としてご検討ください。'}</div>` : ''}
    <div class="card glass reveal hero-result" data-testid="yosou-result">
      <div class="row"><span class="chip blue">${esc(y.bets.label)}</span><span class="chip">${y.bets.points}点</span><span class="spacer"></span><button class="btn secondary small" data-dl data-testid="download-md">${ICON.dl}yosou.md</button></div>
      <div class="big-num" data-testid="total">${yen(y.bets.total)}</div>
      <div class="bet-list" data-testid="bets">${y.bets.bets.map((b, i) => `<div class="bet reveal" style="--i:${i}"><span class="combo">${comboHTML(y.type, b.combo)}</span><span data-testid="bet-amount">${yen(b.amount)}</span></div>`).join('')}</div>
      <b class="small">投票画面での入力</b>
      <ol class="howto">${y.bets.howto.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card glass reveal" style="--i:1"><h2>展開予想</h2><div class="lanes">${lanes}</div><p class="small" style="margin:12px 0 0"><span class="chip indigo">${esc(t.ペース || '-')}ペース</span> ${esc(t.説明 || '')}</p></div>
      <div class="card glass reveal" style="--i:2"><h2>印</h2><div data-testid="marks">${y.印.map((m) => `<div class="mark-row"><span class="mark-sym">${esc(m.印)}</span>${ball(m.馬番)}<div><b>${esc(horseName(m.馬番))}</b><div class="small muted">${esc(m.根拠)}</div></div></div>`).join('')}</div></div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card glass reveal" style="--i:3"><h2>評価を下げた人気馬</h2>${y.評価を下げた人気馬.length ? `<ul class="clean">${y.評価を下げた人気馬.map((x) => `<li><b>${esc(x.馬番)} ${esc(horseName(x.馬番))}</b>：${esc(x.理由)}</li>`).join('')}</ul>` : '<p class="muted">なし</p>'}</div>
      <div class="card glass reveal" style="--i:4"><h2>不安材料と当日の確認</h2><ul class="clean">${y.不安材料.map((x) => `<li>${esc(x)}</li>`).join('')}${y.当日確認.map((x) => `<li>確認：${esc(x)}</li>`).join('')}</ul></div>
    </div>
    <div class="card glass reveal" style="--i:5;margin-top:14px"><h2>全頭評価</h2>
      <div class="table-wrap"><table data-testid="eval-table"><thead><tr><th>馬番</th><th>馬名</th><th>人気</th><th>脚質</th>${META.viewpoints.map((v) => `<th>${esc(v)}</th>`).join('')}</tr></thead>
      <tbody>${y.evals.map((e) => `<tr><td>${ball(e.馬番)}</td><td><b>${esc(e.馬名)}</b></td><td>${esc(e.人気 ?? '-')}</td><td>${esc(e.脚質)}</td>${e.観点.map((x) => `<td><div class="eval-cell"><span class="mk mk-${esc(x.印)}">${esc(x.印)}</span><small>${esc(x.根拠)}</small></div></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card glass reveal" style="--i:6;margin-top:14px"><h2>出典</h2><ul class="clean src">${(state.race.research?.sources || []).map((s) => s.ok ? `<li>[${s.n}] <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>` : `<li class="muted">取得できず：${esc(s.url)}</li>`).join('') || '<li class="muted">なし</li>'}</ul>
      <div class="row end" style="margin-top:10px"><button class="btn" data-go-kekka data-testid="go-kekka">結果を入力</button></div></div>`;
}

// --- 5. 結果 ---
function panelKekka(panel) {
  const race = state.race;
  const y = race.yosou;
  if (!y) { panel.innerHTML = `<div class="card glass reveal"><div class="banner info">先に「予想」を作成してください。</div></div>`; return; }
  const k = race.kekka;
  const nums = race.horses.horses.map((h) => h.馬番);
  const opts = (sel) => `<option value="">-</option>${nums.map((n) => `<option value="${n}" ${Number(sel) === n ? 'selected' : ''}>${n} ${esc(horseName(n))}</option>`).join('')}`;
  panel.innerHTML = `
    <div class="card glass reveal">
      <h2>結果の入力</h2>
      <div class="grid4">${[0, 1, 2].map((i) => `<label class="field"><span>${i + 1}着</span><select class="input" data-ord="${i}" data-testid="order-${i + 1}">${opts(k?.order?.[i])}</select></label>`).join('')}</div>
      <div class="row" style="margin-top:12px"><label class="btn secondary small">${ICON.photo}払戻のスクショから読み取る<input type="file" accept="image/*" hidden id="payImg"></label></div>
      <div id="payFields" style="margin-top:12px"></div>
      <div id="rankFields"></div>
      <label class="field" style="margin-top:12px"><span>メモ（任意）</span><input class="input" id="kmemo" value="${esc(k?.memo || '')}" data-testid="kekka-memo"></label>
      <div class="row end" style="margin-top:14px"><button class="btn" id="doK" data-testid="do-kekka">記録する</button></div>
    </div>
    <div id="kOut" style="margin-top:14px">${k ? kekkaView(k) : ''}</div>`;
  const order = () => $$('[data-ord]', panel).map((s) => Number(s.value) || null);
  const payouts = { ...(k?.payouts || {}) };
  const refresh = async () => {
    const o = order();
    const pf = $('#payFields', panel);
    const rf = $('#rankFields', panel);
    if (o.some((n) => !n) || new Set(o).size !== 3) { pf.innerHTML = ''; rf.innerHTML = ''; return; }
    const { keys, ticket } = await api(`/api/races/${encodeURIComponent(race.id)}/hits`, { method: 'POST', body: { order: o } });
    pf.innerHTML = keys.length
      ? `<div class="banner ok reveal">的中した組があります。100円あたりの払戻金を入力してください。</div><div class="grid4" style="margin-top:10px">${keys.map((key) => `<label class="field"><span>${esc(ticket)} ${esc(key)}</span><input class="input" inputmode="numeric" data-pay="${esc(key)}" value="${esc(payouts[key] || '')}" placeholder="例：1520" data-testid="payout-input"></label>`).join('')}</div>`
      : '<div class="banner info reveal" data-testid="no-hit">買い目に的中はありません。</div>';
    const others = y.印.filter((m) => !o.includes(m.馬番));
    rf.innerHTML = others.length ? `<h3>印の馬の着順（分かれば）</h3><div class="grid4">${others.map((m) => `<label class="field"><span>${esc(m.印)} ${m.馬番} ${esc(horseName(m.馬番))}</span><input class="input" inputmode="numeric" data-rank="${m.馬番}" placeholder="着順"></label>`).join('')}</div>` : '';
  };
  $$('[data-ord]', panel).forEach((s) => s.addEventListener('change', refresh));
  panel.addEventListener('input', (e) => { if (e.target.dataset.pay) payouts[e.target.dataset.pay] = e.target.value; });
  if (k) refresh();
  $('#payImg', panel).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const out = $('#payFields', panel);
    out.innerHTML = inlineSkeleton('払戻金を読み取っています', 3);
    try {
      const { result } = await api(`/api/races/${encodeURIComponent(race.id)}/payout-read`, { method: 'POST', body: { dataUrl: await resizeImage(f) } });
      (result.着順 || []).slice(0, 3).forEach((n, i) => { $(`[data-ord="${i}"]`, panel).value = String(n); });
      const tbl = result.払戻?.[y.bets.ticket] || {};
      Object.entries(tbl).forEach(([key, v]) => { payouts[key.replace(/[ー－]/g, '-')] = v; });
      await refresh();
      toast('読み取りました。内容をご確認ください');
    } catch (err) { out.innerHTML = ''; toast(err.message, 'err'); }
  });
  $('#doK', panel).addEventListener('click', async (e) => {
    const o = order();
    if (o.some((n) => !n) || new Set(o).size !== 3) return toast('1〜3着を選んでください', 'err');
    const missingPay = $$('[data-pay]', panel).filter((el) => !Number(el.value));
    if (missingPay.length) return toast('的中した組の払戻金を入力してください', 'err');
    const ranks = Object.fromEntries($$('[data-rank]', panel).filter((el) => el.value).map((el) => [el.dataset.rank, el.value]));
    const out = $('#kOut', panel);
    out.innerHTML = inlineSkeleton('振り返りを作成しています', 5);
    try {
      const r = await busy(e.currentTarget, () => api(`/api/races/${encodeURIComponent(race.id)}/kekka`, { method: 'POST', body: { order: o, payouts, ranks, memo: $('#kmemo', panel).value } }));
      race.kekka = r.kekka;
      out.innerHTML = kekkaView(r.kekka, r.stats);
      refreshSteps();
      if (r.kekka.hit) confetti();
    } catch { out.innerHTML = ''; }
  });
  $('#kOut', panel).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-approve]');
    if (!b) return;
    const { proposals } = await api('/api/rules');
    const p = proposals.find((x) => x.text === b.dataset.approve);
    if (!p) return toast('この提案は処理済みです');
    await busy(b, () => api(`/api/proposals/${p.id}/approve`, { method: 'POST' }));
    b.outerHTML = '<span class="chip green pop">ルールに追加しました</span>';
  });
}

function kekkaView(k, st) {
  const md = [
    `# ${state.race.id} 結果と振り返り`, '',
    `- 結果：1着 ${k.order[0]} / 2着 ${k.order[1]} / 3着 ${k.order[2]}`,
    `- ${k.hit ? '的中' : '不的中'}（投資 ${k.invest}円 / 払戻 ${k.payout}円）`,
    `- 印の馬の着順：${k.marked.map((m) => `${m.印}${m.馬番}→${m.着順}`).join('、')}`,
    `- 当たった観点：${k.当たった観点.join('・') || 'なし'}`,
    `- 外れた観点：${k.外れた観点.join('・') || 'なし'}`,
    `- 分析：${k.分析}`,
    ...(k.改善案.length ? ['- 改善案：', ...k.改善案.map((x) => `  - ${x}`)] : []),
  ].join('\n');
  return `
    <div class="card glass reveal" data-testid="kekka-result">
      <div class="row"><span class="result-badge ${k.hit ? 'hit' : 'miss'}" data-testid="hit-badge">${k.hit ? '的中' : '不的中'}</span><span class="spacer"></span>
        <button class="btn secondary small" onclick="void 0" data-kmd>${ICON.dl}kekka.md</button></div>
      <div class="grid4" style="margin-top:12px">
        <div><div class="small muted">投資</div><div class="big-num" style="font-size:26px">${yen(k.invest)}</div></div>
        <div><div class="small muted">払戻</div><div class="big-num" style="font-size:26px" data-testid="payout">${yen(k.payout)}</div></div>
        <div><div class="small muted">◎の着順</div><div class="big-num" style="font-size:26px">${esc(k.honmeiRank)}</div></div>
        <div><div class="small muted">軸の着順</div><div class="big-num" style="font-size:26px">${esc(k.axisRank)}</div></div>
      </div>
      <h3>印の馬の着順</h3><div class="row">${k.marked.map((m) => `<span class="chip">${esc(m.印)} ${m.馬番} → ${esc(m.着順)}</span>`).join('')}</div>
      <h3>当たった観点</h3><div class="row">${k.当たった観点.map((x) => `<span class="chip green">${esc(x)}</span>`).join('') || '<span class="muted small">なし</span>'}</div>
      <h3>外れた観点</h3><div class="row">${k.外れた観点.map((x) => `<span class="chip orange">${esc(x)}</span>`).join('') || '<span class="muted small">なし</span>'}</div>
      <h3>分析</h3><p style="margin:0">${esc(k.分析)}</p>
      ${k.改善案.length ? `<h3>ルールの改善案</h3>${k.改善案.map((x) => `<div class="proposal"><p>${esc(x)}</p><button class="btn small" data-approve="${esc(x)}" data-testid="approve-proposal">ルールに追加</button></div>`).join('')}` : ''}
    </div>
    ${st ? `<div class="card glass reveal" style="--i:1;margin-top:14px" data-testid="kekka-stats"><h2>これまでの累計</h2><div class="grid4">
      <div><div class="small muted">投資額</div><b>${yen(st.invest)}</b></div><div><div class="small muted">払戻額</div><b>${yen(st.payout)}</b></div>
      <div><div class="small muted">回収率</div><b>${st.recovery}%</b></div><div><div class="small muted">的中率</div><b>${st.hitRate}%（${st.hits}/${st.count}）</b></div></div>
      <div class="row end" style="margin-top:10px"><a class="btn secondary small" href="#/stats">観点別の傾向を見る</a></div></div>` : ''}
    <template id="kmd">${esc(md)}</template>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-kmd]')) {
    const t = $('#kmd');
    download(`${state.race.id}_kekka.md`, t.innerHTML.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'), 'text/markdown');
  }
});

function confetti() {
  if (reduced) return;
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  const colors = ['#007aff', '#34c759', '#ff9500', '#ff2d55', '#5856d6', '#5ac8fa'];
  wrap.innerHTML = Array.from({ length: 70 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};--dx:${(Math.random() - 0.5) * 240}px;--rot:${Math.random() * 720}deg;animation-delay:${Math.random() * 0.4}s"></i>`).join('');
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 2600);
}

// ---------- 成績 ----------
function countUp(el, to, suffix = '', dec = 0) {
  if (reduced) { el.textContent = to.toLocaleString('ja-JP', { maximumFractionDigits: dec }) + suffix; return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 1100);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = (to * e).toLocaleString('ja-JP', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function viewStats() {
  showSkeleton('stats');
  setTab('stats');
  const st = await api('/api/stats');
  const max = Math.max(1, ...st.points.map((p) => Math.max(p.効いた, p.外れた)));
  const C = 2 * Math.PI * 50;
  render(`
    ${pageHeader('成績', { actions: `<a class="btn secondary small" href="/api/log.csv" download data-testid="csv">${ICON.dl}log.csv</a>` })}
    <div class="grid4">
      <div class="stat glass reveal" style="--i:0"><div class="k">投資額</div><div class="v" data-count="${st.invest}" data-suf="円">0</div></div>
      <div class="stat glass reveal" style="--i:1"><div class="k">払戻額</div><div class="v" data-count="${st.payout}" data-suf="円">0</div></div>
      <div class="stat glass reveal" style="--i:2"><div class="k">的中率</div><div class="v" data-count="${st.hitRate}" data-suf="%" data-dec="1">0</div><div class="small muted">${st.hits} / ${st.count} レース</div></div>
      <div class="stat glass reveal" style="--i:3;display:flex;align-items:center;gap:12px">
        <svg class="ring" viewBox="0 0 120 120"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#007aff"/></linearGradient></defs>
          <circle class="bg" cx="60" cy="60" r="50"/><circle class="fg" cx="60" cy="60" r="50" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-ring="${Math.min(st.recovery, 200) / 200}"/></svg>
        <div><div class="k">回収率</div><div class="v" data-count="${st.recovery}" data-suf="%" data-dec="1" data-testid="recovery">0</div></div>
      </div>
    </div>
    <div class="card glass reveal" style="--i:4;margin-top:14px"><h2>観点別の傾向</h2>
      <div class="bar-row small muted" style="margin-bottom:4px"><span></span><span>効いた</span><span>外れた</span></div>
      <div class="bars">${st.points.map((p) => `<div class="bar-row"><b>${esc(p.観点)}</b>
        <div class="row" style="flex-wrap:nowrap;gap:6px"><div class="bar good" style="flex:1"><i data-w="${(p.効いた / max) * 100}"></i></div><span style="width:18px">${p.効いた}</span></div>
        <div class="row" style="flex-wrap:nowrap;gap:6px"><div class="bar bad" style="flex:1"><i data-w="${(p.外れた / max) * 100}"></i></div><span style="width:18px">${p.外れた}</span></div></div>`).join('')}</div>
    </div>
    <div class="card glass reveal" style="--i:5;margin-top:14px"><h2>記録</h2>
      ${st.rows.length ? `<div class="table-wrap"><table data-testid="log-table"><thead><tr>${['日付', '競馬場', 'R', 'レース名', 'クラス', '券種', '投資', '払戻', '的中', '◎', '軸', '効いた観点', '外れた観点'].map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${st.rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.course)}</td><td>${r.r}</td><td><a href="#/race/${encodeURIComponent(r.race_id)}">${esc(r.race_name || '-')}</a></td><td>${esc(r.class)}</td><td>${esc(r.bet_type)}</td><td>${yen(r.invest)}</td><td>${yen(r.payout)}</td><td>${r.hit ? '<span class="chip green">的中</span>' : '<span class="chip">不的中</span>'}</td><td>${esc(r.honmei_rank)}</td><td>${esc(r.axis_rank)}</td><td>${esc(r.good_points)}</td><td>${esc(r.bad_points)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">まだ記録がありません</p>'}
    </div>`, () => {
    requestAnimationFrame(() => setTimeout(() => {
      $$('[data-count]', app).forEach((el) => countUp(el, Number(el.dataset.count), el.dataset.suf, Number(el.dataset.dec || 0)));
      $$('[data-w]', app).forEach((el) => (el.style.width = `${el.dataset.w}%`));
      const ring = $('[data-ring]', app);
      if (ring) ring.style.strokeDashoffset = String(C * (1 - Number(ring.dataset.ring)));
    }, 150));
  });
  hideSkeleton();
}

// ---------- ルール ----------
async function viewRules() {
  showSkeleton('rules');
  setTab('rules');
  const { rules, proposals, defaults } = await api('/api/rules');
  render(`
    ${pageHeader('ルール')}
    ${proposals.length ? `<div class="card glass reveal"><h2>承認待ちの改善案</h2><div data-testid="proposals">${proposals.map((p) => `<div class="proposal" data-id="${p.id}"><p>${esc(p.text)}<br><span class="small muted">${esc(p.race_id)}</span></p><button class="btn small secondary" data-rej="${p.id}">却下</button><button class="btn small" data-app="${p.id}" data-testid="approve">承認</button></div>`).join('')}</div></div>` : ''}
    <div class="card glass reveal" style="--i:1">
      <h2>予想の観点とルール</h2>
      <textarea class="input rules-editor" id="rules" spellcheck="false" data-testid="rules-editor">${esc(rules)}</textarea>
      <div class="row end" style="margin-top:14px"><button class="btn plain" id="reset">初期値に戻す</button><button class="btn" id="saveR" data-testid="save-rules">保存</button></div>
    </div>`, () => {
    $('#saveR', app).addEventListener('click', async (e) => { await busy(e.currentTarget, () => api('/api/rules', { method: 'PUT', body: { rules: $('#rules', app).value } })); toast('保存しました'); });
    $('#reset', app).addEventListener('click', () => { $('#rules', app).value = defaults; toast('初期値を読み込みました。保存すると反映されます'); });
    $('[data-testid="proposals"]', app)?.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-app],[data-rej]');
      if (!a) return;
      const id = a.dataset.app || a.dataset.rej;
      await busy(a, () => api(`/api/proposals/${id}/${a.dataset.app ? 'approve' : 'reject'}`, { method: 'POST' }));
      toast(a.dataset.app ? 'ルールに追加しました' : '却下しました');
      viewRules();
    });
  });
  hideSkeleton();
}

// ---------- 起動 ----------
bindScroll();
showSkeleton('list');
route();
