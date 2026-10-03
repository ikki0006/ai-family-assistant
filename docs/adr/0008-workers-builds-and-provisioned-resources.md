# ADR-0008: Workers Buildsで配備し、予定するリソースを先に作る

## Status

Accepted (2026-10-04)

## Context

手動起動のGitHub Actionsから、mainへのpushで配備するWorkers Buildsへ切り替える。
今後利用するDBとQueueは、機能実装より先に作成する。
この判断はADR-0007を置き換える。

## Decision

- Worker本体・公開設定・D1・QueueはTerraformが管理する。
- アプリはWorkers Buildsで`pnpm verify:app`を通し、`pnpm run deploy`で配備する。
- 配備元はmainに限定し、非本番ブランチの自動ビルドは無効にする。
- GitHub Actionsの配備workflowは削除し、配備経路を一本化する。
- Workers BuildsにTerraformは要求せず、インフラはローカルのplan/applyで管理する。
- D1を1個、ジョブ用Queueと失敗ジョブ用DLQを各1個作成する。
- Queue consumerとDLQへの振り分けは、処理と再試行設計の実装時に接続する。
- Cronはscheduled handlerと通知・記憶整理処理を実装してから有効にする。
- 現在の単一Worker構成を保ち、用途のない別Workerは追加しない。

## Consequences

リソース作成と機能実装は別段階になる。
D1は空のDBであり、テーブル定義とマイグレーションは後続で追加する。
QueueとDLQも、処理の接続までは空のリソースとなる。
GitHub Appによるリポジトリ接続とWorkers Builds設定はCloudflare画面で行う。
接続に使用するリポジトリは`ikki0006/ai-family-assistant`に限定する。
Build用の認証情報とLINEの実行時Secretを分ける。

## Enforcement

`pnpm verify`でアプリとTerraform書式、`terraform validate`とplanでリソースを確認する。
Workers Buildsの実行結果と、配備後のhealth応答は実際のpush後に確認する。
