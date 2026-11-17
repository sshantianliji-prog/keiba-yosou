import { test, expect } from '@playwright/test';

const PASS = process.env.APP_PASSWORD || 'localtest';
const AI = process.env.E2E_AI !== '0';
const RACE = { date: '2099-01-07', course: '小倉', rnum: '1' };
const RACE_ID = `${RACE.date}_${RACE.course}_${RACE.rnum}R`;

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
  await expect(page.getByTestId('race-list')).toBeVisible();
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
  await expect(page.locator('[data-testid="race-item"][data-id="2026-11-22_京都_11R"]')).toBeVisible();
  await expect(page.locator('#tabbar')).toBeVisible();
});

test('サンプルレースの確認画面に全頭が表示され、要確認なしで確定できる', async ({ page }) => {
  await login(page);
  await page.locator('[data-testid="race-item"][data-id="2026-11-22_京都_11R"]').click();
  await page.getByTestId('step-check').click();
  await expect(page.getByTestId('horse-table').locator('tbody > tr[data-i]')).toHaveCount(8);
});

test('新規レース作成から結果記録まで一通り使える', async ({ page }) => {
  test.skip(!AI, 'AIを使うテストは E2E_AI=0 で省略');
  await login(page);
  // 既存のテストレースを掃除
  await page.request.delete(`/api/races/${encodeURIComponent(RACE_ID)}`);

  await page.getByTestId('new-race').click();
  await page.getByTestId('nr-date').fill(RACE.date);
  await page.getByTestId('nr-course').selectOption(RACE.course);
  await page.getByTestId('nr-rnum').selectOption(RACE.rnum);
  await page.getByTestId('nr-submit').click();
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(RACE_ID)));

  // 1. 読み取り
  await page.getByTestId('paste-text').fill(PASTE);
  await page.getByTestId('do-read').click();
  await expect(page.getByTestId('ai-loading')).toBeVisible();
  await expect(page.getByTestId('go-check')).toBeVisible({ timeout: 180000 });
  await page.getByTestId('go-check').click();

  // 2. 確認（8頭そろっていること）
  const rows = page.getByTestId('horse-table').locator('tbody > tr[data-i]');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0).locator('input[data-k="馬名"]')).toHaveValue(/テスト/);
  await page.getByTestId('confirm-horses').click();
  await expect(page.getByTestId('step-research')).toHaveAttribute('aria-selected', 'true');

  // 3. リサーチ（JRAコース紹介ページ＋取得できないURL）
  await page.getByTestId('urls').fill('https://example.invalid/not-found');
  await page.getByTestId('track-memo').fill('内が伸びている');
  await page.getByTestId('do-research').click();
  const rs = page.getByTestId('research-result');
  await expect(rs).toBeVisible({ timeout: 180000 });
  await expect(rs).toContainText('取得できず');
  await page.getByTestId('go-yosou').click();

  // 4. 予想（3連複 軸1頭流し 600円）
  await page.getByTestId('bet-type').selectOption('sanrenpuku_1');
  await page.getByTestId('budget').fill('600');
  await page.getByTestId('do-yosou').click();
  const yr = page.getByTestId('yosou-result');
  await expect(yr).toBeVisible({ timeout: 300000 });
  await expect(page.getByTestId('total')).toHaveText('600円');
  const amounts = await page.getByTestId('bet-amount').allTextContents();
  expect(amounts.reduce((s, a) => s + Number(a.replace(/[^\d]/g, '')), 0)).toBe(600);
  await expect(page.getByTestId('marks')).toContainText('◎');
  await expect(page.getByTestId('eval-table').locator('tbody tr')).toHaveCount(8);
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-md').click();
  expect((await dl).suggestedFilename()).toContain('yosou.md');

  // 5. 結果（買い目の1組を的中させる）
  const firstCombo = (await page.getByTestId('bets').locator('.bet').first().locator('.num-ball').allTextContents()).map(Number);
  await page.getByTestId('go-kekka').click();
  for (let i = 0; i < 3; i++) await page.getByTestId(`order-${i + 1}`).selectOption(String(firstCombo[i]));
  await expect(page.getByTestId('payout-input').first()).toBeVisible();
  await page.getByTestId('payout-input').first().fill('1520');
  await page.getByTestId('do-kekka').click();
  await expect(page.getByTestId('kekka-result')).toBeVisible({ timeout: 180000 });
  await expect(page.getByTestId('hit-badge')).toHaveText('的中');
  await expect(page.getByTestId('kekka-stats')).toContainText('回収率');

  // 成績ページに記録が出る
  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('log-table')).toContainText('3連複 軸1頭流し');
  const csv = await page.request.get('/api/log.csv');
  const body = await csv.text();
  expect(body).toContain('日付,競馬場,R,レース名,クラス,券種,買い目,投資額,払戻額,的中,◎の着順,軸の着順,効いた観点,外れた観点,メモ');
  expect(body).toContain(RACE.date);
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
  await page.request.post('/api/races', { data: { date: RACE.date, course: RACE.course, rnum: Number(RACE.rnum) } });
  await page.goto(`/#/race/${encodeURIComponent(RACE_ID)}`);
  await page.getByTestId('delete-race').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('race-list')).toBeVisible();
  await expect(page.locator(`[data-testid="race-item"][data-id="${RACE_ID}"]`)).toHaveCount(0);
});

test('スマートフォン幅で横スクロールが出ない @mobile', async ({ page }) => {
  await login(page);
  for (const hash of ['#/', '#/stats', '#/rules', `#/race/${encodeURIComponent('2026-11-22_京都_11R')}`]) {
    await page.goto('/' + hash);
    await expect(page.getByTestId('skeleton')).toHaveAttribute('aria-busy', 'false');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
