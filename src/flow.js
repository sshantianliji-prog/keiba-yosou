// バックグラウンド処理（Cloudflare Workflows）、残り時間の見積もり、プッシュ通知
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { loadRace, saveRace, readRace, doResearch, doYosou, yosouMarkdown, raceKey } from './worker.js';

const STAGES = ['read', 'research', 'yosou'];
const DEFAULT_SEC = { read: 40, research: 12, yosou: 35 };
export const STAGE_LABEL = { read: '出馬表を読み取っています', research: '公開記事を調べています', yosou: '全頭を評価しています' };

// ---------- ジョブ ----------
export async function startJob(env, { raceId, from, type, budget, text = '', partnerCount = null }) {
  const id = 'j' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const stages = STAGES.slice(STAGES.indexOf(from));
  if (text) await env.IMAGES.put(`text:${id}`, text, { expirationTtl: 86400 });
  const t = Date.now();
  await env.DB.prepare('INSERT INTO jobs (id, race_id, status, stage, stages, params, message, started_at, stage_started_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, raceId, 'running', stages[0], JSON.stringify(stages), JSON.stringify({ type, budget, partnerCount, hasText: !!text }), '', t, t).run();
  await env.FLOW.create({ id, params: { jobId: id, raceId, stages, type, budget, partnerCount } });
  return jobView(env, await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first());
}

async function durations(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('durations').first();
  try { return { ...DEFAULT_SEC, ...JSON.parse(row?.value || '{}') }; } catch { return { ...DEFAULT_SEC }; }
}

async function recordDuration(env, stage, sec) {
  const d = await durations(env);
  d[stage] = Math.round((d[stage] * 0.6 + sec * 0.4) * 10) / 10;
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('durations', JSON.stringify(d)).run();
}

async function jobView(env, j) {
  if (!j) return null;
  const est = await durations(env);
  const stages = JSON.parse(j.stages || '[]');
  return {
    id: j.id, race_id: j.race_id, status: j.status, stage: j.stage, stages, message: j.message,
    started_at: j.started_at, stage_started_at: j.stage_started_at, finished_at: j.finished_at,
    now: Date.now(), est, labels: STAGE_LABEL, params: JSON.parse(j.params || '{}'),
  };
}

export async function jobStatus(env, raceId) {
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE race_id = ? ORDER BY started_at DESC LIMIT 1').bind(raceId).first();
  return jobView(env, j);
}

export async function activeJobs(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM jobs WHERE status = 'running' OR (finished_at > ? AND status != 'running') ORDER BY started_at DESC"
  ).bind(Date.now() - 10 * 60e3).all();
  const seen = new Set();
  const out = [];
  for (const j of results) {
    if (seen.has(j.race_id)) continue;
    seen.add(j.race_id);
    out.push(await jobView(env, j));
  }
  return out;
}

async function setStage(env, jobId, stage) {
  await env.DB.prepare('UPDATE jobs SET stage = ?, stage_started_at = ? WHERE id = ?').bind(stage, Date.now(), jobId).run();
}

async function finishJob(env, jobId, status, message = '') {
  await env.DB.prepare('UPDATE jobs SET status = ?, message = ?, finished_at = ? WHERE id = ?').bind(status, message, Date.now(), jobId).run();
}

// ---------- ワークフロー ----------
export class YosouFlow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const { jobId, raceId, stages, type, budget, partnerCount } = event.payload;
    const cfg = { retries: { limit: 1, delay: '3 seconds', backoff: 'constant' }, timeout: '10 minutes' };
    let stopped = null;
    try {
      for (const st of stages) {
        const out = await step.do(st, cfg, async () => {
          await setStage(env, jobId, st);
          const t0 = Date.now();
          const race = await loadRace(env, raceId);
          if (!race) throw new Error('レースが見つかりません');
          let res = { ok: true };
          if (st === 'read') {
            const text = (await env.IMAGES.get(`text:${jobId}`)) || '';
            const result = await readRace(env, { ...race, horses: null }, { text });
            const key = raceKey(result.race);
            const problems = [];
            if (!result.horses.length) problems.push('出走馬を読み取れませんでした');
            if (!key.date || !key.course || !key.rnum) problems.push('日付・競馬場・R番号を判別できませんでした');
            if (result.missing.length) problems.push(`馬番 ${result.missing.join('・')} のデータが足りません`);
            if (result.needsCheck.length) problems.push(`馬番 ${result.needsCheck.join('・')} に読み取りに自信がない値があります`);
            if (!problems.length) result.confirmed = true;
            await saveRace(env, raceId, {
              horses: result, status: problems.length ? 'read' : 'confirmed', race_name: result.race.レース名 || '',
              ...(key.date ? { date: key.date } : {}), ...(key.course ? { course: key.course } : {}), ...(key.rnum ? { rnum: key.rnum } : {}),
            });
            if (problems.length) res = { stop: true, message: problems.join('。') + '。確認画面で修正してください。' };
          } else if (st === 'research') {
            const prev = race.research;
            const urls = (prev?.sources || []).filter((s) => !/jra\.go\.jp\/facilities/.test(s.url)).map((s) => s.url);
            const research = await doResearch(env, race, { urls, memo: prev?.memo || '' });
            await saveRace(env, raceId, { research, status: 'researched' });
          } else if (st === 'yosou') {
            const yosou = await doYosou(env, race, { type, budget, partnerCount });
            yosou.markdown = yosouMarkdown(race, yosou);
            await saveRace(env, raceId, { yosou, status: 'predicted' });
          }
          await recordDuration(env, st, (Date.now() - t0) / 1000);
          return res;
        });
        if (out?.stop) { stopped = out.message; break; }
      }
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 300);
      await step.do('fail', async () => {
        await finishJob(env, jobId, 'error', msg);
        await notifyAll(env, { title: '予想できませんでした', body: msg, url: `/#/race/${raceId}`, tag: jobId });
      });
      return;
    }
    await step.do('finish', async () => {
      const race = await loadRace(env, raceId);
      const name = `${race.course || ''} ${race.rnum ? race.rnum + 'R' : ''} ${race.race_name || ''}`.trim();
      if (stopped) {
        await finishJob(env, jobId, 'needs_check', stopped);
        await notifyAll(env, { title: '確認が必要です', body: `${name}：${stopped}`, url: `/#/race/${raceId}?step=check`, tag: jobId });
      } else {
        await finishJob(env, jobId, 'done');
        const y = race.yosou;
        await notifyAll(env, { title: '予想完了', body: y ? `${name}：${y.bets.label} ${y.bets.total.toLocaleString()}円` : name, url: `/#/race/${raceId}?step=yosou`, tag: jobId });
      }
    });
  }
}

// ---------- プッシュ通知（本文なしのプッシュ＋取得方式） ----------
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (s) => new TextEncoder().encode(s);

export const pushPublicKey = (env) => env.VAPID_PUBLIC || '';

export async function saveSubscription(env, sub) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) throw new Error('通知の登録に失敗しました');
  await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint, data, created_at) VALUES (?, ?, ?)')
    .bind(sub.endpoint, JSON.stringify(sub), new Date().toISOString()).run();
}

export async function latestNotice(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('last_notice').first();
  try { return JSON.parse(row?.value || 'null') || { title: '予想完了', body: '', url: '/' }; } catch { return { title: '予想完了', body: '', url: '/' }; }
}

async function vapidJWT(env, aud) {
  const header = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(`${header}.${payload}`));
  return `${header}.${payload}.${b64u(sig)}`;
}

export async function notifyAll(env, notice) {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('last_notice', JSON.stringify({ ...notice, at: Date.now() })).run();
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return [];
  const { results } = await env.DB.prepare('SELECT endpoint FROM push_subs').all();
  return Promise.all(results.map(async ({ endpoint }) => {
    try {
      const jwt = await vapidJWT(env, new URL(endpoint).origin);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { TTL: '86400', Urgency: 'high', Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'Content-Length': '0' },
      });
      await env.DB.prepare('UPDATE push_subs SET last_status = ? WHERE endpoint = ?').bind(res.status, endpoint).run();
      if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
      return res.status;
    } catch {
      return 0;
    }
  }));
}
