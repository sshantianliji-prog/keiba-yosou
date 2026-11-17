# keiba-yosou

自分専用の競馬予想ウェブアプリです。JRA 公式サイトの出馬表のスクリーンショット（またはコピーしたテキスト）から全頭のデータを読み取り、10 の観点で評価して、印・買い目・根拠を出します。結果を入力すると振り返りと回収率を記録します。

- Cloudflare Workers / D1 / KV / Workers AI（有料データ・有料 API は使いません）
- 金額配分と的中判定はコードで計算し、合計は予算と一致します
- パスコードでログインする自分専用の構成です

## セットアップ

```sh
npm install
npx wrangler d1 create keiba-yosou        # 出力された database_id を wrangler.jsonc に記入
npx wrangler kv namespace create IMAGES   # 出力された id を wrangler.jsonc に記入
npx wrangler d1 execute keiba-yosou --remote --file=schema.sql
npx wrangler secret put APP_PASSWORD
npx wrangler deploy
```

## テスト

```sh
npm test                                              # 買い目計算
BASE_URL=https://<your-worker>.workers.dev APP_PASSWORD=... npm run test:e2e   # ブラウザ操作
```
