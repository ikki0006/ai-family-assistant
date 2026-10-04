# AI Family Assistant

家族のLINEグループで会話、記憶、予定の参照・通知を扱うCloudflare Worker。
TypeScript / Hono / Agents Sessions / D1 / Queuesを使用する。

## ローカル開発

Node・pnpm・Terraformのバージョンは[.mise.toml](.mise.toml)に固定している。
`mise install`を使うか、同じバージョンを用意する。

```sh
mise install
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm hooks:install
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

起動後、Wranglerが表示するURLの`/health`で疎通を確認する。
LINE認証の設定前でもhealthは利用できる。実LINEのWebhookには公開HTTPS URLが必要。

[.dev.vars.example](.dev.vars.example)に従ってローカルの値を設定する。アプリは`.env`を併用しない。

| 設定 | 用途 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | Webhook署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE返信・Push |
| `LINE_ALLOWED_GROUP_ID` | 返信を許可する家族グループ |
| `TAVILY_API_KEY` | 任意。Web検索 |
| `GH_IMPROVEMENT_TOKEN` | 任意。承認された改善のActions起動 |

AI binding・Gateway ID・DB・Queue・DO bindingは[wrangler.jsonc](wrangler.jsonc)に定義する。
GoogleキーはGatewayのStored Keysへ登録する。[初回設定](docs/deployment.md)を参照。
ローカルのAI bindingもリモートを呼ぶ。統合テストではAI・LINE送信をモックする。
`pnpm dev`だけではTerraform管理のQueue consumerを接続しないため、Queue経路は`pnpm test:workers`で検証する。

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | Biome・依存方向・ADR形式。書換えなし |
| `pnpm fix` | Biomeの自動修正・整形 |
| `pnpm typecheck` | アプリとruntime非依存層の型検査 |
| `pnpm test` | 単体テスト |
| `pnpm test:workers` | Workers / D1 / DOの統合テスト |
| `pnpm test:improvement-agent` | 自動改善スクリプトのテスト |
| `pnpm verify` | 全チェック・全テスト・ビルド・Terraform書式 |
| `pnpm verify:app` | Terraform不要のアプリ検証（Workers Builds用） |
| `pnpm build` | 配備用の`dist/`を生成。配備はしない |

コードの変更時は`pnpm verify`を実行する。依存更新時は`pnpm-lock.yaml`も更新する。
実データ、APIキー、`.dev.vars`、`.env.cloudflare`、Terraform stateはGitに入れない。
レイヤーと配置先は[アーキテクチャ](docs/architecture.md)、変更時の規約は[AGENTS.md](AGENTS.md)を参照する。

## 配備

インフラはTerraform、通常のアプリ配備はmainへのpushを契機とするWorkers Builds。
DB migrationは自動実行しない。初回構築・Secret登録・schema更新は[配備手順](docs/deployment.md)に従う。

設定済み環境への手動配備:

```sh
set -a
source .env.cloudflare
set +a
pnpm verify
pnpm run deploy
```

`pnpm run deploy`は生成済みの`dist/index.js`を配備するため、先にビルドを含む検証を行う。
配備後は`/health`と実行ログを確認する。

## ドキュメント

[docsの索引](docs/README.md)から、機能仕様・運用・予算・残タスク・設計判断を参照できる。
