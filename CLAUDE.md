# keiba-yosou

自分専用の競馬予想ウェブアプリ。Cloudflare Workers ＋ D1 ＋ KV ＋ Workers AI。

## 守ること
- 有料データ（JRA-VAN など）や有料APIは使わない。AIは Workers AI のみ
- サイトを自動で大量に取得しない。リサーチは利用者が指定した無料公開ページと JRA のコース紹介ページを1件ずつ取得するだけ
- 有料・会員限定・アクセス拒否のページは使わず「取得できず」と表示する
- 画面の文言はすべて日本語の丁寧語。キャッチコピーは入れない
- 金額計算・的中判定・回収率は AI に任せず `src/bets.js` で計算する

## 構成
- `src/worker.js` … API（読み取り・確認・リサーチ・予想・結果・成績・ルール）
- `src/bets.js` … 買い目の組み立て、予算ちょうどの金額配分、的中判定
- `src/rules.js` … 既定の予想観点とルール（アプリの「ルール」画面で編集可、D1 の settings に保存）
- `src/research.js` … 公開ページ1件の取得と本文抽出
- `public/` … フロントエンド（リキッドグラス UI、フレームワークなし）
- `schema.sql` … D1 のテーブル
- `tests/` … `npm test`（買い目計算）、`npm run test:e2e`（Playwright によるブラウザ操作テスト）

## 開発
- ローカル：`.dev.vars` に `APP_PASSWORD=...` を書き、`npx wrangler dev`
- デプロイ：`npx wrangler deploy`、パスコードは `npx wrangler secret put APP_PASSWORD`
- E2E：`BASE_URL=https://... APP_PASSWORD=... npm run test:e2e`（AIを使うテストを省くときは `E2E_AI=0`）
