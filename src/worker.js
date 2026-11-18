import { chatJSON, FAST_MODEL } from './ai.js';
import { YosouFlow, startJob, jobStatus, activeJobs, pushPublicKey, saveSubscription, latestNotice } from './flow.js';
export { YosouFlow };
import { BET_TYPES, buildBets, settle, comboKey, judge } from './bets.js';
import { DEFAULT_RULES, VIEWPOINTS, VIEWPOINT_DESC } from './rules.js';
import { fetchSource, courseUrl } from './research.js';
import { SAMPLE_RACE } from './sample.js';

// ---------- 共通 ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const fail = (message, status = 400) => json({ error: message }, status);
const now = () => new Date().toISOString();
const J = (s, d = null) => {
  if (s == null) return d;
  try { return JSON.parse(s); } catch { return d; }
};

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const safeEq = (a, b) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
const cookie = (req, name) =>
  (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1) || '';

async function authed(req, env) {
  if (!env.APP_PASSWORD) return false;
  const tok = cookie(req, 'ky');
  return tok && safeEq(tok, await hmac(env.APP_PASSWORD, 'keiba-yosou-session-v1'));
}

async function getRules(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('rules').first();
  if (row) return row.value;
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('rules', DEFAULT_RULES).run();
  return DEFAULT_RULES;
}

async function ensureSample(env) {
  const flag = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('sample').first();
  if (flag) return;
  const s = SAMPLE_RACE;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO races (id, date, course, rnum, race_name, status, horses, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(s.id, s.date, s.course, s.rnum, s.race_name, 'read', JSON.stringify(s.horses), now(), now()),
    env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('sample', '1'),
  ]);
}

export async function loadRace(env, id) {
  const r = await env.DB.prepare('SELECT * FROM races WHERE id = ?').bind(id).first();
  if (!r) return null;
  return {
    ...r,
    images: J(r.images, []),
    horses: J(r.horses),
    research: J(r.research),
    yosou: J(r.yosou),
    kekka: J(r.kekka),
  };
}

export async function saveRace(env, id, fields) {
  const keys = Object.keys(fields);
  const vals = keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k]));
  await env.DB.prepare(`UPDATE races SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...vals, now(), id)
    .run();
}

// ---------- 読み取り ----------
const COURSES = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
export function raceKey(info = {}) {
  const m = String(info.日付 || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  const date = m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  const course = COURSES.find((c) => String(info.競馬場 || '').includes(c)) || '';
  const r = parseInt(String(info.R番号 ?? '').replace(/[^\d]/g, ''), 10);
  return { date, course, rnum: r >= 1 && r <= 12 ? r : 0 };
}
const READ_SYSTEM = `あなたはJRA公式サイトの出馬表（馬柱）を書き写す担当です。
写っている情報だけを正確に書き写してください。推測で値を埋めてはいけません。
読めない・自信がない値は null にするか読めた値を入れたうえで、その馬に "要確認": true を付け、"要確認項目" に項目名を入れてください。
出力は次の形のJSONのみで、説明文は書かないでください。
{
 "race": {"日付":"YYYY-MM-DD","競馬場":"京都","R番号":11,"レース名":"ジャパンカップ や 3歳未勝利 など（開催回日は含めない）","クラス":"GⅠ/GⅡ/GⅢ/リステッド/オープン/3勝クラス/2勝クラス/1勝クラス/未勝利/新馬","芝ダ":"芝|ダート|障害","距離":2000,"回り":"内回り|外回り|なし","頭数":18,"発走時刻":"15:40","馬場状態":"良|稍重|重|不良"},
 "horses": [
  {"枠番":1,"馬番":1,"馬名":"","性齢":"牡4","斤量":58.0,"騎手":"","調教師":"","単勝オッズ":3.5,"人気":1,"馬体重":480,"増減":-2,"戦績":"5-2-1-3",
   "近走":[{"日付":"2026-10-12","競馬場":"東京","レース名":"","クラス":"GⅡ","距離":"芝1800","馬場":"良","頭数":12,"人気":2,"着順":1,"タイム":"1:45.2","通過順":"3-3-2","上がり3F":33.8,"着差":"0.2","相手":"相手の馬名"}],
   "要確認": false, "要確認項目": []}
 ]
}
近走は新しい順に最大4走。写っていない項目は null。`;

function mergeRead(parts) {
  const race = {};
  const map = new Map();
  for (const p of parts) {
    for (const [k, v] of Object.entries(p?.race || {})) if (v != null && v !== '' && race[k] == null) race[k] = v;
    for (const h of p?.horses || []) {
      const no = Number(h?.馬番);
      if (!Number.isInteger(no) || no < 1 || no > 18) continue;
      const cur = map.get(no) || {};
      const merged = { ...cur };
      for (const [k, v] of Object.entries(h)) {
        if (k === '近走') {
          if ((v?.length || 0) > (cur.近走?.length || 0)) merged.近走 = v.slice(0, 4);
        } else if (k === '要確認項目') {
          merged.要確認項目 = [...new Set([...(cur.要確認項目 || []), ...(v || [])])];
        } else if (k === '要確認') {
          merged.要確認 = !!(cur.要確認 || v);
        } else if (v != null && v !== '' && merged[k] == null) merged[k] = v;
      }
      merged.馬番 = no;
      map.set(no, merged);
    }
  }
  const horses = [...map.values()].sort((a, b) => a.馬番 - b.馬番);
  return validate({ race, horses });
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.\-+]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function validate(data) {
  const { race = {}, horses = [] } = data;
  for (const h of horses) {
    const flags = new Set(h.要確認項目 || []);
    const check = (k, ok) => { if (!ok) flags.add(k); };
    check('枠番', Number.isInteger(num(h.枠番)) && num(h.枠番) >= 1 && num(h.枠番) <= 8);
    check('馬名', typeof h.馬名 === 'string' && h.馬名.trim().length >= 2);
    check('斤量', num(h.斤量) >= 48 && num(h.斤量) <= 63);
    check('単勝オッズ', num(h.単勝オッズ) >= 1);
    check('人気', Number.isInteger(num(h.人気)) && num(h.人気) >= 1);
    if (h.馬体重 != null) check('馬体重', num(h.馬体重) >= 340 && num(h.馬体重) <= 640);
    check('騎手', typeof h.騎手 === 'string' && h.騎手.trim().length >= 1);
    h.要確認項目 = [...flags];
    h.要確認 = flags.size > 0;
    h.近走 = Array.isArray(h.近走) ? h.近走.slice(0, 4) : [];
  }
  const n = num(race.頭数) || Math.max(0, ...horses.map((h) => h.馬番));
  const have = new Set(horses.map((h) => h.馬番));
  const missing = [];
  for (let i = 1; i <= n; i++) if (!have.has(i)) missing.push(i);
  return { race, horses, missing, needsCheck: horses.filter((h) => h.要確認).map((h) => h.馬番) };
}

export async function readRace(env, race, { text }) {
  const parts = [];
  const errors = [];
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const hint = race.date && race.course
    ? `参考：このレースは ${race.date} ${race.course} ${race.rnum}R です。`
    : `参考：今日の日付は ${today} です。出馬表に年が書かれていなければ、今日に最も近い年と判断してください。日付・競馬場・R番号は必ず読み取ってください。`;
  const jobs = [];
  if (text && text.trim()) {
    // 馬番の範囲ごとに並列で読み取り、応答を短くして待ち時間を減らす
    const ranges = [[1, 5], [6, 10], [11, 14], [15, 18]];
    for (const [a, b] of ranges) {
      jobs.push(
        chatJSON(env, {
          system: READ_SYSTEM,
          user: `${hint}\n次はJRAサイトの出馬表からコピーしたテキストです。このうち馬番 ${a}〜${b} の馬だけを書き写してください（該当する馬がいなければ horses は空配列）。race は毎回すべて埋めてください。\n\n${text.slice(0, 30000)}`,
          maxTokens: 4000,
          model: env.READ_MODEL || FAST_MODEL,
        }).catch((e) => { errors.push(`テキスト（馬番${a}〜${b}）：${e.message}`); return null; })
      );
    }
  }
  for (const img of race.images) {
    jobs.push(
      env.IMAGES.get(img.key).then((dataUrl) =>
        dataUrl
          ? chatJSON(env, { system: READ_SYSTEM, user: `${hint}\nこの画像に写っている全馬を書き写してください。`, images: [dataUrl], maxTokens: 8000 })
          : null
      ).catch((e) => { errors.push(`${img.name}：${e.message}`); return null; })
    );
  }
  parts.push(...(await Promise.all(jobs)).filter(Boolean));
  if (!parts.length) throw new Error(errors[0] || '読み取る画像またはテキストがありません');
  const prev = race.horses;
  const result = mergeRead(prev ? [prev, ...parts] : parts);
  result.errors = errors;
  return result;
}

// ---------- リサーチ ----------
const isGrade = (cls) => /G|重賞|Ｇ/.test(cls || '');

export async function doResearch(env, race, { urls = [], memo = '' }) {
  const info = race.horses?.race || {};
  const list = [...new Set([courseUrl(race.course), ...urls.map((u) => String(u).trim())].filter(Boolean))].slice(0, 8);
  const sources = [];
  for (const u of list) sources.push(await fetchSource(u)); // 1件ずつ順番に取得
  const usable = sources.filter((s) => s.ok);
  const grade = isGrade(info.クラス);
  const system = `あなたは競馬予想のリサーチ担当です。与えられた公開ページの本文だけを根拠に要点をまとめます。
本文に書かれていないことは書かず、その項目は "取得できず" と書いてください。各要点の末尾に出典番号を [1] のように付けます。
日本語の丁寧語で、JSONのみを出力してください。`;
  const user = `レース：${race.date} ${race.course}${race.rnum}R ${info.レース名 || ''}（${info.クラス || 'クラス不明'}・${info.芝ダ || ''}${info.距離 || ''}m・${info.回り || ''}・馬場${info.馬場状態 || '不明'}）
${grade ? 'このレースは重賞です。過去10年の傾向（人気・脚質・前走ローテ・枠・年齢・血統）を探してください。' : 'このレースは条件戦などのため、過去10年データではなく同じコース・同じクラスの傾向を探してください。'}
当日の馬場メモ（利用者の入力）：${memo || 'なし'}

出典：
${usable.map((s, i) => `[${i + 1}] ${s.title || ''} ${s.url}\n${s.text}`).join('\n\n') || 'なし'}

出力形式：
{"過去傾向":["…[1]"],"コース特徴":["直線の長さ…[1]","最初のコーナーまでの距離…","有利な脚質と枠…"],"当日馬場":["…"],"その他":["…"],"データ十分":true}`;
  let summary;
  try {
    summary = usable.length || memo ? await chatJSON(env, { system, user, maxTokens: 3000 }) : null;
  } catch (e) {
    summary = null;
  }
  const blank = ['取得できず'];
  const sec = (k) => {
    const v = (Array.isArray(summary?.[k]) ? summary[k] : []).map(String).filter((x) => !/^取得できず/.test(x));
    return v.length ? v : blank;
  };
  return {
    grade,
    sections: {
      [grade ? '過去10年の傾向' : '同コース・同クラスの傾向']: sec('過去傾向'),
      コースの特徴: sec('コース特徴'),
      当日の馬場と傾向: memo ? [...sec('当日馬場').filter((x) => x !== '取得できず'), `利用者メモ：${memo}`] : sec('当日馬場'),
      その他: sec('その他'),
    },
    enough: !!summary?.データ十分 && usable.length > 0,
    memo,
    sources: usable.map((s, i) => ({ n: i + 1, url: s.url, title: s.title, ok: true }))
      .concat(sources.filter((s) => !s.ok).map((s) => ({ url: s.url, title: s.title || '', ok: false, reason: s.reason }))),
    at: now(),
  };
}

// ---------- 予想 ----------
const compactHorse = (h) => ({
  枠: h.枠番, 番: h.馬番, 名: h.馬名, 性齢: h.性齢, 斤: h.斤量, 騎: h.騎手, 厩: h.調教師,
  単: h.単勝オッズ, 人: h.人気, 体重: h.馬体重 != null ? `${h.馬体重}(${h.増減 ?? '?'})` : null, 戦績: h.戦績,
  近走: (h.近走 || []).map((r) => [r.日付, r.競馬場, r.レース名, r.クラス, r.距離, r.馬場, r.頭数 && `${r.頭数}頭`, r.人気 && `${r.人気}人`, r.着順 && `${r.着順}着`, r.タイム, r.通過順, r.上がり3F, r.着差, r.相手].filter((x) => x != null && x !== '').join(' ')),
});

function researchText(rs) {
  if (!rs) return 'リサーチ未実施';
  return Object.entries(rs.sections).map(([k, v]) => `■${k}\n${v.map((x) => '・' + x).join('\n')}`).join('\n');
}

export async function doYosou(env, race, { type, budget, partnerCount }) {
  if (!BET_TYPES[type]) throw new Error('券種を選んでください');
  const rules = await getRules(env);
  const data = race.horses;
  const info = data.race;
  const horses = data.horses.map(compactHorse);
  const raceLine = `${race.date} ${race.course}${race.rnum}R ${info.レース名 || ''} ${info.クラス || ''} ${info.芝ダ || ''}${info.距離 || ''}m ${info.回り || ''} ${info.頭数 || horses.length}頭 馬場:${info.馬場状態 || '不明'}`;
  const base = `【ルール】\n${rules}\n\n【レース】${raceLine}\n\n【リサーチ】\n${researchText(race.research)}\n\n【出走馬】\n${horses.map((h) => JSON.stringify(h)).join('\n')}`;
  const system = 'あなたは競馬予想の分析担当です。与えられたデータとルールだけに基づいて評価し、日本語の丁寧語で、JSONのみを出力します。データにない事実を作らないでください。';

  // 1) 全頭評価（6頭ずつ並列）
  const groups = [];
  for (let i = 0; i < data.horses.length; i += 4) groups.push(data.horses.slice(i, i + 4).map((h) => h.馬番));
  const evalPrompt = (nos) => `${base}

馬番 ${nos.join('・')} を評価してください。観点は次の10個で、この順番です。
${VIEWPOINTS.map((v, i) => `${i + 1}.${v}：${VIEWPOINT_DESC[i]}`).join('\n')}
各観点に ◎/○/△/× を付け、25字以内の根拠を書きます。データがない観点は △ にして「データなし」と書きます。
脚質は通過順から 逃げ/先行/中団/後方 のどれかで判定します。崩れにくさは3着以内の安定感を0〜5で評価します。
出力：{"evals":[{"馬番":1,"脚質":"先行","印列":"◎○△×○△○△○◎","根拠":["…10個…"],"崩れにくさ":3,"総合":78,"一言":"40字以内"}]}`;
  const evalParts = await Promise.all(groups.map((g) => chatJSON(env, { system, user: evalPrompt(g), maxTokens: 3500, model: env.EVAL_MODEL || FAST_MODEL }).catch(() => chatJSON(env, { system, user: evalPrompt(g), maxTokens: 3500 }))));
  const evals = new Map();
  for (const p of evalParts) for (const e of p?.evals || []) if (data.horses.some((h) => h.馬番 === Number(e.馬番))) evals.set(Number(e.馬番), e);
  const evalList = data.horses.map((h) => {
    const e = evals.get(h.馬番) || {};
    const marks = [...String(e.印列 || '')].filter((c) => '◎○△×'.includes(c));
    return {
      馬番: h.馬番, 馬名: h.馬名, 人気: h.人気, 単勝オッズ: h.単勝オッズ,
      脚質: e.脚質 || '不明',
      観点: VIEWPOINTS.map((v, i) => ({ 観点: v, 印: marks[i] || '△', 根拠: (e.根拠 || [])[i] || 'データなし' })),
      崩れにくさ: Number(e.崩れにくさ) || 0,
      総合: Number(e.総合) || 0,
      一言: e.一言 || '',
    };
  });

  // 2) 印・展開・軸の決定
  const sumPrompt = `${base}

【全頭評価】
${evalList.map((e) => `${e.馬番}番 ${e.馬名}（${e.人気 ?? '?'}人気・${e.脚質}・総合${e.総合}・崩れにくさ${e.崩れにくさ}）${e.観点.map((x) => x.観点 + x.印).join(' ')} ${e.一言}`).join('\n')}

券種：${BET_TYPES[type].label}
上の評価とルールに従って印と展開を決めてください。◎○▲は1頭ずつ、△は最大3頭、☆は人気薄の穴馬1頭。
"軸" は券種に合わせた軸馬（3連複なら崩れにくさ優先。軸2頭流しなら2頭）。"相手" は評価の高い順に最大6頭（軸を除く）。
データが不足していれば "データ不足": true とし、"見送り推奨" も検討してください。
出力：{"展開":{"逃げ":[馬番],"先行":[],"中団":[],"後方":[],"ペース":"スロー|ミドル|ハイ","説明":"100字以内"},
"印":[{"馬番":1,"印":"◎","根拠":"満たした観点を挙げて80字以内"}],
"軸":[1],"相手":[2,3],
"評価を下げた人気馬":[{"馬番":4,"理由":"60字以内"}],
"不安材料":["…"],"当日確認":["…"],"データ不足":false,"見送り推奨":false,"見送り理由":""}`;
  const s = await chatJSON(env, { system, user: sumPrompt, maxTokens: 3000 });

  const valid = new Set(data.horses.map((h) => h.馬番));
  const ok = (n) => valid.has(Number(n));
  const marks = (s.印 || []).filter((m) => ok(m.馬番) && '◎○▲△☆'.includes(m.印)).map((m) => ({ ...m, 馬番: Number(m.馬番) }));
  const rankByScore = [...evalList].sort((a, b) => b.総合 - a.総合).map((e) => e.馬番);
  // 印が足りないときは総合評価の順に補う（◎○▲は1頭ずつ、△は最大2頭）
  const want = ['◎', '○', '▲', '△', '△'].slice(0, Math.max(1, Math.min(5, data.horses.length - 1)));
  for (const sym of want) {
    const have = marks.filter((m) => m.印 === sym).length;
    const need = want.filter((x) => x === sym).length;
    if (have >= need) continue;
    const n = rankByScore.find((no) => !marks.some((m) => m.馬番 === no));
    if (n == null) break;
    const e = evalList.find((x) => x.馬番 === n);
    const good = e.観点.filter((x) => x.印 === '◎' || x.印 === '○').map((x) => x.観点);
    marks.push({ 馬番: n, 印: sym, 根拠: `総合評価${e.総合}。${good.length ? `${good.join('・')}で高評価。` : ''}${e.一言 || ''}` });
  }
  const honmei = marks.find((m) => m.印 === '◎')?.馬番 || rankByScore[0];
  const markOrder = ['◎', '○', '▲', '△', '☆'];
  const byMarks = [...marks].sort((a, b) => markOrder.indexOf(a.印) - markOrder.indexOf(b.印)).map((m) => m.馬番);
  let partners = [...new Set([...(s.相手 || []).map(Number).filter(ok), ...byMarks, ...rankByScore])];
  let axes = (s.軸 || []).map(Number).filter(ok);
  const def = BET_TYPES[type];
  if (!type.startsWith('sanrenpuku') || !axes.length) axes = [honmei];
  if (def.kind === 'nagashi2' && axes.length < 2) axes = [...new Set([...axes, ...byMarks, ...rankByScore])].slice(0, 2);
  else if (def.kind !== 'nagashi2') axes = axes.slice(0, 1);
  partners = partners.filter((n) => !axes.includes(n));

  const defaults = { single: 0, box: def.size === 3 ? 4 : 3, nagashi: def.size === 3 ? 5 : 4, nagashi2: 5, tan1: 4 };
  let count = Number(partnerCount) || defaults[def.kind];
  const pointsFor = (c) => {
    if (def.kind === 'single') return 1 + c;
    if (def.kind === 'box') { const n = c + 1; return def.size === 2 ? (n * (n - 1)) / 2 : (n * (n - 1) * (n - 2)) / 6; }
    if (def.kind === 'nagashi') return def.size === 2 ? c : (c * (c - 1)) / 2;
    if (def.kind === 'nagashi2') return c;
    return c * (c - 1);
  };
  const minC = { single: 0, box: def.size - 1, nagashi: def.size - 1, nagashi2: 1, tan1: 2 }[def.kind];
  while (count > minC && pointsFor(count) * 100 > budget) count--;
  let bets;
  const singleExtra = def.kind === 'single' ? partners.slice(0, count) : [];
  bets = buildBets({
    type, budget,
    axes: def.kind === 'single' ? [...axes, ...singleExtra] : def.kind === 'box' ? [axes[0], ...partners.slice(0, count)] : axes,
    partners: def.kind === 'single' || def.kind === 'box' ? [] : partners.slice(0, count),
  });

  return {
    at: now(),
    type, budget,
    bets,
    展開: s.展開 || {},
    印: marks,
    評価を下げた人気馬: (s.評価を下げた人気馬 || []).filter((x) => ok(x.馬番)),
    不安材料: s.不安材料 || [],
    当日確認: s.当日確認 || [],
    データ不足: !!s.データ不足 || !race.research?.enough,
    見送り推奨: !!s.見送り推奨,
    見送り理由: s.見送り理由 || '',
    evals: evalList,
  };
}

export function yosouMarkdown(race, y) {
  const info = race.horses?.race || {};
  const name = (n) => race.horses.horses.find((h) => h.馬番 === n)?.馬名 || '';
  const L = [];
  L.push(`# ${race.date} ${race.course}${race.rnum}R ${info.レース名 || ''} 予想`, '');
  L.push('## 1. 結論', `- 券種：${y.bets.label}（${y.bets.points}点・合計 ${y.bets.total.toLocaleString()}円）`);
  y.bets.bets.forEach((b) => L.push(`  - ${comboKey(y.type, b.combo)}：${b.amount}円`));
  L.push('- 投票画面での入力：', ...y.bets.howto.map((x) => `  - ${x}`));
  if (y.データ不足) L.push('- ※データが十分に取れていません。見送りも選択肢です。');
  if (y.見送り推奨) L.push(`- ※見送り推奨：${y.見送り理由}`);
  const t = y.展開;
  L.push('', '## 2. 展開予想', `- 逃げ：${(t.逃げ || []).join('・') || '-'} / 先行：${(t.先行 || []).join('・') || '-'} / 中団：${(t.中団 || []).join('・') || '-'} / 後方：${(t.後方 || []).join('・') || '-'}`, `- 想定ペース：${t.ペース || '-'}　${t.説明 || ''}`);
  L.push('', '## 3. 印と根拠');
  y.印.forEach((m) => L.push(`- ${m.印} ${m.馬番} ${name(m.馬番)}：${m.根拠}`));
  L.push('', '## 4. 評価を下げた人気馬');
  (y.評価を下げた人気馬.length ? y.評価を下げた人気馬 : [{ 馬番: '-', 理由: 'なし' }]).forEach((x) => L.push(`- ${x.馬番} ${name(x.馬番)}：${x.理由}`));
  L.push('', '## 5. 不安材料と当日確認', ...y.不安材料.map((x) => `- ${x}`), ...y.当日確認.map((x) => `- 確認：${x}`));
  L.push('', '## 6. 出典URL');
  (race.research?.sources || []).forEach((s) => L.push(s.ok ? `- [${s.n}] ${s.title} ${s.url}` : `- 取得できず：${s.url}（${s.reason}）`));
  L.push('', '## 全頭評価');
  L.push(`| 馬番 | 馬名 | 脚質 | ${VIEWPOINTS.join(' | ')} |`, `|${'---|'.repeat(VIEWPOINTS.length + 3)}`);
  y.evals.forEach((e) => L.push(`| ${e.馬番} | ${e.馬名} | ${e.脚質} | ${e.観点.map((x) => `${x.印} ${x.根拠}`).join(' | ')} |`));
  return L.join('\n');
}

// ---------- 結果 ----------
async function doKekka(env, race, { order, payouts, ranks = {}, memo = '' }) {
  const y = race.yosou;
  if (!y) throw new Error('先に予想を作成してください');
  order = order.map(Number);
  if (order.length !== 3 || order.some((n) => !Number.isInteger(n) || n < 1) || new Set(order).size !== 3) {
    throw new Error('1〜3着の馬番を正しく入力してください');
  }
  const runners = race.horses?.horses?.length || 18;
  const result = settle(y.bets, order, payouts, runners);
  const rankOf = (n) => {
    const i = order.indexOf(n);
    if (i >= 0) return String(i + 1);
    return ranks[n] ? String(ranks[n]) : '4着以下';
  };
  const marked = y.印.map((m) => ({ ...m, 着順: rankOf(m.馬番) }));
  const honmei = y.印.find((m) => m.印 === '◎')?.馬番;
  const axis = y.bets.axes[0];

  const evalLines = y.evals
    .filter((e) => y.印.some((m) => m.馬番 === e.馬番) || order.includes(e.馬番))
    .map((e) => `${e.馬番}番（着順:${rankOf(e.馬番)}）${e.観点.map((x) => `${x.観点}${x.印}`).join(' ')}`)
    .join('\n');
  const system = '競馬予想の振り返り担当です。日本語の丁寧語で、JSONのみを出力します。';
  const user = `【現在のルール】\n${await getRules(env)}\n\n【レース】${race.date} ${race.course}${race.rnum}R
【結果】1着${order[0]} 2着${order[1]} 3着${order[2]}
【印】${marked.map((m) => `${m.印}${m.馬番}→${m.着順}`).join(' ')}
【買い目】${y.bets.label} ${y.bets.bets.map((b) => comboKey(y.type, b.combo)).join(' ')} → ${result.hit ? '的中' : '不的中'}
【観点別評価】\n${evalLines}
【利用者メモ】${memo || 'なし'}

観点名は次から選んでください：${VIEWPOINTS.join('、')}
上位に来た馬を高く評価できていた観点を「当たった観点」、評価を誤った観点を「外れた観点」とします。
出力：{"当たった観点":["…"],"外れた観点":["…"],"分析":"外れた原因を1〜3行で","改善案":["ルールに足すべき具体的な一文（不要なら空配列）"]}`;
  let r;
  try {
    r = await chatJSON(env, { system, user, maxTokens: 1500 });
  } catch {
    r = { 当たった観点: [], 外れた観点: [], 分析: '振り返りを自動生成できませんでした。', 改善案: [] };
  }
  const pick = (a) => [...new Set((a || []).map(String).filter((x) => VIEWPOINTS.includes(x)))];
  const kekka = {
    at: now(), order, payouts, memo, ...result,
    marked,
    当たった観点: pick(r.当たった観点),
    外れた観点: pick(r.外れた観点),
    分析: String(r.分析 || ''),
    改善案: (r.改善案 || []).map(String).filter(Boolean).slice(0, 3),
    honmeiRank: honmei ? rankOf(honmei) : '-',
    axisRank: axis ? rankOf(axis) : '-',
  };
  const info = race.horses?.race || {};
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO log (race_id, date, course, r, race_name, class, bet_type, bets, invest, payout, hit, honmei_rank, axis_rank, good_points, bad_points, memo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(race_id) DO UPDATE SET bet_type=excluded.bet_type, bets=excluded.bets, invest=excluded.invest, payout=excluded.payout, hit=excluded.hit,
      honmei_rank=excluded.honmei_rank, axis_rank=excluded.axis_rank, good_points=excluded.good_points, bad_points=excluded.bad_points, memo=excluded.memo, race_name=excluded.race_name, class=excluded.class`)
      .bind(race.id, race.date, race.course, race.rnum, info.レース名 || race.race_name || '', info.クラス || '', y.bets.label,
        y.bets.bets.map((b) => `${comboKey(y.type, b.combo)}(${b.amount})`).join(' '), result.invest, result.payout, result.hit ? 1 : 0,
        kekka.honmeiRank, kekka.axisRank, kekka.当たった観点.join('・'), kekka.外れた観点.join('・'), memo),
    env.DB.prepare('DELETE FROM proposals WHERE race_id = ? AND status = ?').bind(race.id, 'pending'),
    ...kekka.改善案.map((t) => env.DB.prepare('INSERT INTO proposals (race_id, text) VALUES (?, ?)').bind(race.id, t)),
  ]);
  return kekka;
}

async function stats(env) {
  const { results: rows } = await env.DB.prepare('SELECT * FROM log ORDER BY date DESC, r DESC').all();
  const invest = rows.reduce((s, r) => s + (r.invest || 0), 0);
  const payout = rows.reduce((s, r) => s + (r.payout || 0), 0);
  const hits = rows.filter((r) => r.hit).length;
  const points = VIEWPOINTS.map((v) => ({
    観点: v,
    効いた: rows.filter((r) => (r.good_points || '').split('・').includes(v)).length,
    外れた: rows.filter((r) => (r.bad_points || '').split('・').includes(v)).length,
  }));
  return {
    count: rows.length, invest, payout, hits,
    recovery: invest ? Math.round((payout / invest) * 1000) / 10 : 0,
    hitRate: rows.length ? Math.round((hits / rows.length) * 1000) / 10 : 0,
    points, rows,
  };
}

const CSV_HEAD = ['日付', '競馬場', 'R', 'レース名', 'クラス', '券種', '買い目', '投資額', '払戻額', '的中', '◎の着順', '軸の着順', '効いた観点', '外れた観点', 'メモ'];
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---------- ルーター ----------
async function api(req, env, path) {
  const method = req.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await req.json().catch(() => ({}));

  if (path === '/api/login' && method === 'POST') {
    if (!env.APP_PASSWORD) return fail('パスコードが未設定です', 503);
    const ok = safeEq(await hmac('cmp', String(body.password || '')), await hmac('cmp', env.APP_PASSWORD));
    if (!ok) return fail('パスコードが違います', 401);
    const tok = await hmac(env.APP_PASSWORD, 'keiba-yosou-session-v1');
    return json({ ok: true }, 200, { 'set-cookie': `ky=${tok}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
  }
  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': 'ky=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  if (!(await authed(req, env))) return fail('ログインしてください', 401);

  if (path === '/api/me') return json({ ok: true, vapid: pushPublicKey(env), betTypes: Object.fromEntries(Object.entries(BET_TYPES).map(([k, v]) => [k, v.label])), viewpoints: VIEWPOINTS });

  if (path === '/api/intake' && method === 'POST') {
    const images = (body.images || []).slice(0, 8);
    const text = String(body.text || '');
    if (!images.length && !text.trim()) return fail('出馬表の画像またはテキストを入れてください');
    if (!BET_TYPES[body.type]) return fail('券種を選んでください');
    const budget = Number(body.budget);
    if (!Number.isInteger(budget) || budget < 100 || budget % 100) return fail('予算は100円単位で入力してください');
    const id = 'r' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const imgs = [];
    for (const im of images) {
      const dataUrl = String(im.dataUrl || '');
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) || dataUrl.length > 8_000_000) return fail('画像形式が正しくありません');
      const key = `img:${id}:${crypto.randomUUID()}`;
      await env.IMAGES.put(key, dataUrl);
      imgs.push({ key, name: String(im.name || '画像').slice(0, 80) });
    }
    await env.DB.prepare('INSERT INTO races (id, date, course, rnum, race_name, status, images, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, '', '', 0, '', 'new', JSON.stringify(imgs), now(), now()).run();
    const job = await startJob(env, { raceId: id, from: 'read', type: body.type, budget, text });
    return json({ raceId: id, job });
  }
  if (path === '/api/jobs/active') return json({ jobs: await activeJobs(env) });
  if (path === '/api/push/key') return json({ key: pushPublicKey(env) });
  if (path === '/api/push/subscribe' && method === 'POST') { await saveSubscription(env, body); return json({ ok: true }); }
  if (path === '/api/push/latest') return json(await latestNotice(env));
  if (path === '/api/push/status') {
    const { results } = await env.DB.prepare('SELECT last_status, created_at FROM push_subs').all();
    return json({ subscriptions: results.length, statuses: results.map((r) => r.last_status) });
  }
  if (path === '/api/races' && method === 'GET') {
    await ensureSample(env);
    const { results } = await env.DB.prepare(
      'SELECT r.id, r.date, r.course, r.rnum, r.race_name, r.status, r.updated_at, l.hit, l.invest, l.payout FROM races r LEFT JOIN log l ON l.race_id = r.id ORDER BY r.date DESC, r.rnum DESC'
    ).all();
    const jobs = await activeJobs(env);
    return json({ races: results.map((r) => ({ ...r, job: jobs.find((j) => j.race_id === r.id) || null })) });
  }
  if (path === '/api/races' && method === 'POST') {
    const date = String(body.date || '');
    const course = String(body.course || '');
    const rnum = Number(body.rnum);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('日付を入力してください');
    if (!course) return fail('競馬場を選んでください');
    if (!Number.isInteger(rnum) || rnum < 1 || rnum > 12) return fail('R番号は1〜12で入力してください');
    const id = `${date}_${course}_${rnum}R`;
    const exists = await env.DB.prepare('SELECT id FROM races WHERE id = ?').bind(id).first();
    if (!exists) {
      await env.DB.prepare('INSERT INTO races (id, date, course, rnum, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(id, date, course, rnum, now(), now()).run();
    }
    return json({ id, existed: !!exists });
  }

  if (path === '/api/stats') return json(await stats(env));
  if (path === '/api/log.csv') {
    const { rows } = await stats(env);
    const lines = [CSV_HEAD.join(','), ...[...rows].reverse().map((r) => [r.date, r.course, r.r, r.race_name, r.class, r.bet_type, r.bets, r.invest, r.payout, r.hit ? '的中' : '不的中', r.honmei_rank, r.axis_rank, r.good_points, r.bad_points, r.memo].map(csvCell).join(','))];
    return new Response('﻿' + lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="log.csv"' } });
  }
  if (path === '/api/rules' && method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM proposals WHERE status = 'pending' ORDER BY id DESC").all();
    return json({ rules: await getRules(env), proposals: results, defaults: DEFAULT_RULES });
  }
  if (path === '/api/rules' && method === 'PUT') {
    const text = String(body.rules || '').trim();
    if (text.length < 10) return fail('ルールが短すぎます');
    await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('rules', text).run();
    return json({ ok: true });
  }
  let m = path.match(/^\/api\/proposals\/(\d+)\/(approve|reject)$/);
  if (m && method === 'POST') {
    const p = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(Number(m[1])).first();
    if (!p) return fail('提案が見つかりません', 404);
    if (m[2] === 'approve') {
      let rules = await getRules(env);
      const head = '## 予想ルール（過去の反省から決めたもの）';
      if (rules.includes(head)) {
        const idx = rules.indexOf(head) + head.length;
        const nextSec = rules.indexOf('\n## ', idx);
        const at = nextSec < 0 ? rules.length : nextSec;
        rules = rules.slice(0, at).replace(/\s*$/, '') + `\n- ${p.text}\n` + rules.slice(at);
      } else rules += `\n- ${p.text}\n`;
      await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('rules', rules).run();
    }
    await env.DB.prepare('UPDATE proposals SET status = ? WHERE id = ?').bind(m[2] === 'approve' ? 'approved' : 'rejected', p.id).run();
    return json({ ok: true });
  }

  m = path.match(/^\/api\/races\/([^/]+)(?:\/(.+))?$/);
  if (!m) return fail('見つかりません', 404);
  const id = decodeURIComponent(m[1]);
  const sub = m[2] || '';
  const race = await loadRace(env, id);
  if (!race) return fail('レースが見つかりません', 404);

  if (!sub && method === 'GET') return json({ race, rulesDefaults: null });
  if (!sub && method === 'DELETE') {
    await Promise.all(race.images.map((i) => env.IMAGES.delete(i.key)));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM races WHERE id = ?').bind(id),
      env.DB.prepare('DELETE FROM log WHERE race_id = ?').bind(id),
    ]);
    return json({ ok: true });
  }
  if (sub === 'job' && method === 'GET') return json({ job: await jobStatus(env, id) });
  if (sub === 'job' && method === 'POST') {
    const from = ['read', 'research', 'yosou'].includes(body.from) ? body.from : 'research';
    if (from !== 'read' && !race.horses?.confirmed) return fail('先に出走馬データを確認してください');
    if (!BET_TYPES[body.type]) return fail('券種を選んでください');
    const budget = Number(body.budget);
    if (!Number.isInteger(budget) || budget < 100 || budget % 100) return fail('予算は100円単位で入力してください');
    const running = await jobStatus(env, id);
    if (running?.status === 'running') return fail('このレースはすでに処理中です');
    const job = await startJob(env, { raceId: id, from, type: body.type, budget, text: String(body.text || ''), partnerCount: body.partnerCount || null });
    return json({ job });
  }
  if (sub === 'images' && method === 'POST') {
    const dataUrl = String(body.dataUrl || '');
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) return fail('画像形式が正しくありません');
    if (dataUrl.length > 8_000_000) return fail('画像が大きすぎます');
    if (race.images.length >= 8) return fail('画像は8枚までです');
    const key = `img:${id}:${crypto.randomUUID()}`;
    await env.IMAGES.put(key, dataUrl);
    const images = [...race.images, { key, name: String(body.name || '画像').slice(0, 80) }];
    await saveRace(env, id, { images });
    return json({ images });
  }
  m = sub.match(/^images\/(.+)$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    if (!race.images.some((i) => i.key === key)) return fail('画像が見つかりません', 404);
    if (method === 'DELETE') {
      await env.IMAGES.delete(key);
      const images = race.images.filter((i) => i.key !== key);
      await saveRace(env, id, { images });
      return json({ images });
    }
    const dataUrl = await env.IMAGES.get(key);
    if (!dataUrl) return fail('画像が見つかりません', 404);
    const [, mime, b64] = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bin, { headers: { 'content-type': mime, 'cache-control': 'private, max-age=86400' } });
  }
  if (sub === 'read' && method === 'POST') {
    const result = await readRace(env, { ...race, horses: body.reset ? null : race.horses }, body);
    if (result.race.レース名 && !race.race_name) race.race_name = result.race.レース名;
    await saveRace(env, id, { horses: result, status: 'read', race_name: race.race_name || result.race.レース名 || '' });
    return json({ horses: result });
  }
  if (sub === 'horses' && method === 'PUT') {
    const v = validate({ race: body.race || {}, horses: (body.horses || []).map((h) => ({ ...h, 要確認項目: [] })) });
    if (body.confirm) {
      if (v.missing.length) return fail(`馬番 ${v.missing.join('・')} のデータが足りません`);
      v.confirmed = true;
      v.horses.forEach((h) => { h.要確認 = false; h.要確認項目 = []; });
      v.needsCheck = [];
    }
    const key = raceKey(v.race);
    if (body.confirm && (!key.date || !key.course || !key.rnum)) return fail('日付・競馬場・R番号を入力してください');
    await saveRace(env, id, {
      horses: v, status: body.confirm ? 'confirmed' : 'read', race_name: v.race.レース名 || race.race_name || '',
      ...(key.date ? { date: key.date } : {}), ...(key.course ? { course: key.course } : {}), ...(key.rnum ? { rnum: key.rnum } : {}),
    });
    return json({ horses: v });
  }
  if (sub === 'research' && method === 'POST') {
    if (!race.horses?.confirmed) return fail('先に出走馬データを確認してください');
    const research = await doResearch(env, race, body);
    await saveRace(env, id, { research, status: 'researched' });
    return json({ research });
  }
  if (sub === 'yosou' && method === 'POST') {
    if (!race.horses?.confirmed) return fail('先に出走馬データを確認してください');
    const yosou = await doYosou(env, race, { type: body.type, budget: Number(body.budget), partnerCount: body.partnerCount });
    yosou.markdown = yosouMarkdown(race, yosou);
    await saveRace(env, id, { yosou, status: 'predicted' });
    return json({ yosou });
  }
  if (sub === 'payout-read' && method === 'POST') {
    const dataUrl = String(body.dataUrl || '');
    if (!/^data:image\//.test(dataUrl)) return fail('画像を選んでください');
    const r = await chatJSON(env, {
      system: 'JRAの払戻金表を書き写す担当です。JSONのみを出力します。',
      user: '画像の着順と払戻金を書き写してください。出力：{"着順":[1着馬番,2着馬番,3着馬番],"払戻":{"単勝":{"5":350},"複勝":{"5":150,"3":220,"7":400},"馬連":{"3-5":1200},"ワイド":{"3-5":500,"5-7":900,"3-7":1500},"3連複":{"3-5-7":4500},"3連単":{"5→3→7":21000}}}　組番は小さい順にハイフン区切り（3連単は着順どおり矢印）。金額は100円あたりの数値。',
      images: [dataUrl], maxTokens: 1200,
    });
    return json({ result: r });
  }
  if (sub === 'kekka' && method === 'POST') {
    const kekka = await doKekka(env, race, body);
    await saveRace(env, id, { kekka, status: 'settled' });
    return json({ kekka, stats: await stats(env) });
  }
  if (sub === 'hits' && method === 'POST') {
    // 1〜3着から、払戻金の入力が必要な組を返す
    const y = race.yosou;
    if (!y) return fail('予想がありません');
    const order = (body.order || []).map(Number);
    const runners = race.horses?.horses?.length || 18;
    const keys = y.bets.bets.filter((b) => judge(y.type, b.combo, order, runners)).map((b) => comboKey(y.type, b.combo));
    return json({ keys, ticket: y.bets.ticket });
  }
  return fail('見つかりません', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, url.pathname);
      } catch (e) {
        return fail(e.message || '処理に失敗しました', 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
