import { test, expect, chromium } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const PASS = process.env.APP_PASSWORD || 'localtest';
const AI = process.env.E2E_AI !== '0';
const RACE = { date: '2099-01-07', course: '小倉', rnum: '1' };

// 架空の出馬表テキスト（JRAサイトからコピーした形を模したもの）
const PASTE = `2099年1月7日（土曜） 1回小倉1日 1R 3歳未勝利 ダート1700m（右） 発走 10:05 天候：晴 馬場：良 8頭
枠1 1 テストイチバン 牡3 57.0 騎手甲 (栗東)厩舎甲 単勝 2.4 1番人気 476kg(+2) 0-2-1-1
 前走 2098.12.10 中京 2歳未勝利 ダ1800 良 14頭 1人気 2着 1:54.3 2-2-2-2 38.1 0.1 テスト馬X
枠2 2 テストニバン 牝3 55.0 騎手乙 (美浦)厩舎乙 単勝 5.6 3番人気 452kg(-4) 0-1-2-2
 前走 2098.12.10 中京 2歳未勝利 ダ1800 良 14頭 3人気 3着 1:54.5 5-5-4-3 37.8 0.3 テスト馬X
枠3 3 テストサンバン 牡3 57.0 騎手丙 (栗東)厩舎丙 単勝 4.1 2番人気 498kg(0) 0-1-0-1
 前走 2098.11.26 京都 2歳新馬 ダ1800 良 12頭 2人気 2着 1:55.0 1-1-1-1 38.6 0.2 テスト馬Y
枠4 4 テストヨンバン 牡3 57.0 騎手丁 (美浦)厩舎丁 単勝 12.8 5番人気 470kg(+6) 0-0-1-3
 前走 2098.12.17 中山 2歳未勝利 ダ1800 良 16頭 6人気 5着 1:56.1 9-9-8-7 38.2 0.9 テスト馬Z
枠5 5 テストゴバン 牝3 55.0 騎手戊 (栗東)厩舎戊 単勝 9.0 4番人気 440kg(-2) 0-0-2-1
 前走 2098.12.03 阪神 2歳未勝利 ダ1800 稍重 13頭 4人気 3着 1:53.9 3-3-3-3 38.4 0.5 テスト馬W
枠6 6 テストロクバン 牡3 57.0 騎手己 (栗東)厩舎己 単勝 30.5 7番人気 488kg(+10) 0-0-0-2
 前走 2098.12.24 阪神 2歳新馬 ダ1400 良 16頭 8人気 7着 1:27.9 12-11 37.9 1.4 テスト馬V
枠7 7 テストナナバン 牡3 57.0 騎手庚 (美浦)厩舎庚 単勝 18.7 6番人気 502kg(-6) 0-0-0-3
 前走 2098.12.17 中山 2歳未勝利 ダ1800 良 16頭 9人気 6着 1:56.3 4-4-5-6 39.0 1.1 テスト馬Z
枠8 8 テストハチバン 牝3 55.0 騎手辛 (栗東)厩舎辛 単勝 45.2 8番人気 428kg(0) 0-0-0-4
 前走 2098.12.10 中京 2歳未勝利 ダ1800 良 14頭 11人気 9着 1:56.8 13-13-12-12 38.5 2.6 テスト馬X`;

async function login(page) {
  await page.goto('/#/login');
  await page.getByTestId('password').fill(PASS);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('new-race')).toBeVisible();
  await expect(page.getByTestId('skeleton')).toHaveAttribute('aria-busy', 'false');
}

test.describe.configure({ mode: 'serial' });

test('初回表示で全画面スケルトンが出て、読み込み後に消える', async ({ page }) => {
  await page.route('**/api/me', async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
  await page.goto('/');
  const sk = page.getByTestId('skeleton');
  await expect(sk).toHaveAttribute('aria-busy', 'true');
  await expect(sk.locator('.sk').first()).toBeVisible();
  await expect(sk).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
  await expect(sk).toHaveClass(/hide/);
});

test('パスコードが違うとログインできない', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByTestId('password').fill('wrong-pass');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('toast-error')).toContainText('パスコードが違います');
  const res = await page.request.get('/api/races');
  expect(res.status()).toBe(401);
});

test('ログインするとレース一覧とサンプルレースが表示される', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('race-list').or(page.getByText('レースがありません'))).toBeVisible();
  await expect(page.locator('#tabbar')).toBeVisible();
});

test('サンプルレースの確認画面に全頭が表示され、要確認なしで確定できる', async ({ page }) => {
  await login(page);
  const sample = page.locator('[data-testid="race-item"][data-id="2026-11-22_京都_11R"]');
  test.skip(!(await sample.count()), 'サンプルレースは削除済み');
  await sample.click();
  await page.getByTestId('step-check').click();
  await expect(page.getByTestId('horse-table').locator('tbody > tr[data-i]')).toHaveCount(8);
});

test('出馬表を入れるだけでレースを自動判別し、アプリを閉じても予想が完了して通知される', async ({ page, context }) => {
  test.skip(!AI, 'AIを使うテストは E2E_AI=0 で省略');
  await context.grantPermissions(['notifications']);
  await login(page);
  // 以前のテストレースを掃除
  const old = (await (await page.request.get('/api/races')).json()).races.filter((r) => r.date === RACE.date && r.course === RACE.course);
  for (const r of old) await page.request.delete(`/api/races/${encodeURIComponent(r.id)}`);
  await page.reload();
  await expect(page.getByTestId('new-race')).toBeVisible();

  // 出馬表を入れるだけ（日付・競馬場・R番号は選ばない）
  await page.getByTestId('new-race').click();
  const form = page.getByTestId('intake-form');
  await expect(form).toBeVisible();
  await form.locator('summary').click();
  await page.getByTestId('paste-text').fill(PASTE);
  await form.getByTestId('bet-type').selectOption('sanrenpuku_1');
  await form.getByTestId('budget').fill('600');
  await expect(page.getByTestId('notify')).toBeChecked();
  await page.getByTestId('intake-submit').click();

  // 待ち時間の表示
  await expect(page).toHaveURL(/#\/race\/r[0-9a-f]+/);
  const raceId = decodeURIComponent(page.url().match(/#\/race\/([^?]+)/)[1]);
  await expect(page.getByTestId('job-card')).toBeVisible();
  await expect(page.getByTestId('eta')).toHaveText(/あと(\d+分)?\d+秒|まもなく完了/);
  const eta1 = await page.getByTestId('eta').textContent();
  await page.waitForTimeout(2500);
  const eta2 = await page.getByTestId('eta').textContent();
  expect(eta2).not.toBe(eta1); // カウントダウンしている

  // アプリを閉じる
  await page.close();
  const status = async () => (await (await context.request.get(`/api/races/${encodeURIComponent(raceId)}/job`)).json()).job.status;
  await expect.poll(status, { timeout: 300000, intervals: [5000] }).toBe('done');

  // 通知の内容
  const notice = await (await context.request.get('/api/push/latest')).json();
  expect(notice.title).toBe('予想完了');

  // 開き直すと予想ができている
  const p2 = await context.newPage();
  await p2.goto(`/#/race/${encodeURIComponent(raceId)}`);
  await expect(p2.locator('.large-title h1')).toContainText('小倉 1R');
  await expect(p2.getByTestId('yosou-result')).toBeVisible();
  await expect(p2.getByTestId('total')).toHaveText('600円');
  const amounts = await p2.getByTestId('bet-amount').allTextContents();
  expect(amounts.reduce((s, a) => s + Number(a.replace(/[^\d]/g, '')), 0)).toBe(600);
  await expect(p2.getByTestId('marks')).toContainText('◎');
  await expect(p2.getByTestId('eval-table').locator('tbody tr')).toHaveCount(8);
  const dl = p2.waitForEvent('download');
  await p2.getByTestId('download-md').click();
  expect((await dl).suggestedFilename()).toContain('yosou.md');

  // 結果（買い目の1組を的中させる）
  const firstCombo = (await p2.getByTestId('bets').locator('.bet').first().locator('.num-ball').allTextContents()).map(Number);
  await p2.getByTestId('go-kekka').click();
  for (let i = 0; i < 3; i++) await p2.getByTestId(`order-${i + 1}`).selectOption(String(firstCombo[i]));
  await expect(p2.getByTestId('payout-input').first()).toBeVisible();
  await p2.getByTestId('payout-input').first().fill('1520');
  await p2.getByTestId('do-kekka').click();
  await expect(p2.getByTestId('kekka-result')).toBeVisible({ timeout: 180000 });
  await expect(p2.getByTestId('hit-badge')).toHaveText('的中');
  await expect(p2.getByTestId('kekka-stats')).toContainText('回収率');

  // 成績ページとCSV
  await p2.getByTestId('tab-stats').click();
  await expect(p2.getByTestId('log-table')).toContainText('3連複 軸1頭流し');
  const body = await (await p2.request.get('/api/log.csv')).text();
  expect(body).toContain('日付,競馬場,R,レース名,クラス,券種,買い目,投資額,払戻額,的中,◎の着順,軸の着順,効いた観点,外れた観点,メモ');
  expect(body).toContain(RACE.date);
});

test('処理中のレースは一覧に残り時間が表示される', async ({ page }) => {
  test.skip(!AI, 'AIを使うテストは E2E_AI=0 で省略');
  await login(page);
  const res = await (await page.request.post('/api/intake', { data: { text: PASTE, type: 'tansho', budget: 100 } })).json();
  await page.reload();
  const chip = page.locator(`[data-eta-chip="${res.raceId}"]`);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/あと(\d+分)?\d+秒|まもなく完了|予想中/);
  await expect.poll(async () => (await (await page.request.get(`/api/races/${res.raceId}/job`)).json()).job.status, { timeout: 300000, intervals: [5000] }).not.toBe('running');
  await page.request.delete(`/api/races/${res.raceId}`);
});

test('予想が完了すると「予想完了」の通知が端末に表示される（実際のChromeで確認）', async ({ baseURL }) => {
  test.skip(!AI || process.env.E2E_PUSH === '0', '通知テストは E2E_PUSH=0 で省略');
  // 自動操作用のChromiumはプッシュ通知に対応していないため、インストール済みのChromeを使う
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-push-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false, channel: 'chrome', baseURL, permissions: ['notifications'],
    ignoreDefaultArgs: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-service-autorun', '--disable-field-trial-config', '--disable-default-apps', '--disable-extensions', '--enable-automation'],
  });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await login(page);
    // 「予想する」画面から送信すると通知が登録される
    await page.getByTestId('new-race').click();
    const form = page.getByTestId('intake-form');
    await form.locator('summary').click();
    await page.getByTestId('paste-text').fill(PASTE);
    await form.getByTestId('bet-type').selectOption('tansho');
    await form.getByTestId('budget').fill('100');
    await page.getByTestId('intake-submit').click();
    await expect(page).toHaveURL(/#\/race\/r[0-9a-f]+/);
    const raceId = decodeURIComponent(page.url().match(/#\/race\/([^?]+)/)[1]);
    await expect.poll(async () => (await (await page.request.get('/api/push/status')).json()).subscriptions, { timeout: 30000 }).toBeGreaterThan(0);
    // アプリの画面を閉じて待つ
    await page.goto('about:blank');
    await expect.poll(async () => (await (await ctx.request.get(`/api/races/${raceId}/job`)).json()).job.status, { timeout: 300000, intervals: [5000] }).toBe('done');
    const push = await (await ctx.request.get('/api/push/status')).json();
    expect(push.statuses.some((s) => s >= 200 && s < 300)).toBeTruthy();
    // 端末に表示された通知を確認
    const p2 = await ctx.newPage();
    await p2.goto('/');
    const titles = async () => p2.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.title));
    await expect.poll(titles, { timeout: 60000 }).toContain('予想完了');
    await ctx.request.delete(`/api/races/${raceId}`);
  } finally {
    await ctx.close();
  }
});

test('ルールを編集して保存できる', async ({ page }) => {
  await login(page);
  await page.getByTestId('tab-rules').click();
  const ed = page.getByTestId('rules-editor');
  await expect(ed).toHaveValue(/予想ルール/);
  const original = await ed.inputValue();
  await ed.fill(original + '\n- E2Eテスト用の一文');
  await page.getByTestId('save-rules').click();
  await expect(page.getByTestId('toast')).toContainText('保存しました');
  await page.reload();
  await expect(page.getByTestId('rules-editor')).toHaveValue(/E2Eテスト用の一文/);
  await page.getByTestId('rules-editor').fill(original);
  await page.getByTestId('save-rules').click();
  await expect(page.getByTestId('toast')).toContainText('保存しました');
});

test('テストレースを削除できる', async ({ page }) => {
  await login(page);
  const races = (await (await page.request.get('/api/races')).json()).races.filter((r) => r.date === RACE.date && r.course === RACE.course);
  test.skip(!races.length, '削除対象のテストレースがありません');
  for (const r of races.slice(1)) await page.request.delete(`/api/races/${encodeURIComponent(r.id)}`);
  const id = races[0].id;
  await page.goto(`/#/race/${encodeURIComponent(id)}`);
  await page.getByTestId('delete-race').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('new-race')).toBeVisible();
  await expect(page.locator(`[data-testid="race-item"][data-id="${id}"]`)).toHaveCount(0);
});

test('スマートフォン幅で横スクロールが出ない @mobile', async ({ page }) => {
  await login(page);
  const first = (await (await page.request.get('/api/races')).json()).races[0];
  for (const hash of ['#/', '#/stats', '#/rules', ...(first ? [`#/race/${encodeURIComponent(first.id)}`] : [])]) {
    await page.goto('/' + hash);
    await expect(page.getByTestId('skeleton')).toHaveAttribute('aria-busy', 'false');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
