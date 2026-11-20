# keiba-yosou

自分専用の競馬予想ウェブアプリ。Cloudflare Workers ＋ D1 ＋ KV ＋ Workers AI。

## 守ること
- 有料データ（JRA-VAN など）は使わない。AI は、secret `ANTHROPIC_API_KEY` があれば Claude（Opus 5.5、2026-11-20 にユーザーが決定）、なければ Workers AI（無料枠）。切り替えは `src/ai.js` の `chatJSON`。テキスト貼り付けの読み取りだけは `preferFree` で無料AIを先に使い、失敗・枠切れ時に Claude へ切り替える（費用削減のためのユーザー決定）
- リサーチ：Claude 利用時は `doWebResearch` が web_search（最大6回）で条件・過去傾向・コース特徴を調べ、`research.conditions` でレース情報の空欄と推定日付（`日付推定`）を埋める。予想の前にクラス・芝ダ・距離が空なら止めて確認画面で入力を求める（flow.js の yosou 段階）
- 実測コスト（2026-11-20、Opus）：読み取り約$0.29、ネット検索リサーチ約$0.37、全頭評価(high)約$0.41、まとめ約$0.12
- Claude アプリ連携：画面の「Claude 用の指示をコピー」（`CLAUDE_APP_PROMPT`）でユーザーが Claude アプリにスクショを書き起こさせ、結果の JSON を貼ると `parseStructured` が AI なしで取り込む（読み取り0円）。形式を変えるときはプロンプトとパーサーを両方直す
- サイトを自動で大量に取得しない。リサーチは利用者が指定した無料公開ページと JRA のコース紹介ページを1件ずつ取得するだけ
- 有料・会員限定・アクセス拒否のページは使わず「取得できず」と表示する
- 画面の文言はすべて日本語の丁寧語。キャッチコピーは入れない
- 金額計算・的中判定・回収率は AI に任せず `src/bets.js` で計算する

## 構成
- `src/worker.js` … API（読み取り・確認・リサーチ・予想・結果・成績・ルール）
- `src/bets.js` … 買い目の組み立て、予算ちょうどの金額配分、的中判定
- `src/rules.js` … 既定の予想観点とルール（アプリの「ルール」画面で編集可、D1 の settings に保存）
- `src/research.js` … 公開ページ1件の取得と本文抽出
- `src/flow.js` … Cloudflare Workflows による読み取り→リサーチ→予想のバックグラウンド処理、残り時間の見積もり、Web Push 通知（本文なしのプッシュ＋SW から最新通知を取得）
- 出馬表画像の読み取り：アプリ側（`prepareImage`）で縦長スクショを約4頭ずつの帯に切り、元画像と一緒に保存（images[].parts）。サーバーは帯ごとに Qwen 3.8（思考オフ）で配列形式の JSON を読み、`fromCompact` で整形・マージ。1枚まるごとだと AI がタイムアウト／出力切れになる（2026-11-19 確認）。Qwen は近走配列を閉じ忘れて次の馬を入れ子にする癖があり `collectHorseArrs` で救済している
- AI 無料枠：画像2枚（帯12枚）の読み取りでおよそ 5,000 neurons（1日 10,000）。動作確認で本番 AI を何度も動かさないこと
- `public/` … フロントエンド（リキッドグラス UI、フレームワークなし）
- `schema.sql` … D1 のテーブル
- `tests/` … `npm test`（買い目計算）、`npm run test:e2e`（Playwright によるブラウザ操作テスト）

## 開発
- ローカル：`.dev.vars` に `APP_PASSWORD=...` を書き、`npx wrangler dev`
- デプロイ：`npx wrangler deploy`、パスコードは `npx wrangler secret put APP_PASSWORD`
- 通知の秘密鍵は `VAPID_PRIVATE_JWK`（secret）、公開鍵は wrangler.jsonc の `VAPID_PUBLIC`
- E2E：`BASE_URL=https://... APP_PASSWORD=... npm run test:e2e`（AIを使うテストを省くときは `E2E_AI=0`）
