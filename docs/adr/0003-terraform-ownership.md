# ADR-0003: CloudflareリソースをTerraformで管理する

## Status

Superseded by [ADR-0007](0007-manual-app-deployment.md) (2026-10-04)

## Context

Cloudflareの設定をコードで管理するという要件がある。
TerraformとWranglerが同じ本番設定を更新すると、差分やロールバックの責任が曖昧になる。

## Decision

- `infra/`をTerraformのルートとする。
- Workerの本番配備、D1、Queues、Cron、公開設定はTerraformで管理する。
- `wrangler deploy --dry-run --outdir dist`でビルド成果物だけを生成する。本番配備はTerraformで行う。
- `wrangler.jsonc`はローカル開発、テスト、型生成用とする。本番リソースIDはTerraformのoutputから連携する。
- DBのテーブル変更はSQLマイグレーションとして管理し、TerraformによるDBリソース作成と分ける。
- state、tfvars、APIキーをGitに保存しない。リモートstateとシークレットの渡し方は本番配備前に決める。

## Consequences

LINE疎通用にWorkerとworkers.dev公開設定を定義する。
D1、Queues、Cronは機能を追加する段階で定義する。
本番の秘密値はWorkers Secretsとして登録し、Terraformは`keep_bindings`で既存のsecret_text bindingを保持する。
秘密値そのものはTerraformの変数やstateへ渡さない。
リモートstate、DBマイグレーション、デプロイCIは後続作業とする。

## Enforcement

`pnpm infra:fmt`で書式を検査する。
`terraform -chdir=infra init -backend=false`後、`pnpm infra:validate`で設定を検査する。
リソース追加時はplanを確認し、Wranglerとの二重管理がないことをレビューする。
