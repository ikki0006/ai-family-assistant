# ADR-0007: アプリ配備を手動起動のGitHub Actionsへ分離する

## Status

Superseded by [ADR-0008](0008-workers-builds-and-provisioned-resources.md) (2026-10-04)

## Context

インフラはTerraformで管理し、アプリはGitHub Actionsから手動起動で配備したい。
Terraformがアプリコードも保持すると、インフラ変更時に古いコードへ戻す可能性がある。
この判断はADR-0003を置き換える。

## Decision

- Terraformの`cloudflare_worker`でWorker本体とworkers.dev公開設定を管理する。
- Terraformではコード、バージョン、Secretを管理しない。初回applyにアプリのビルドは不要。
- アプリコード、compatibility設定、binding設定はWranglerが管理する。
- GitHub Actionsは`workflow_dispatch`だけで起動し、`pnpm verify`成功後にビルド済みコードを配備する。
- Worker名、workers.dev有効、preview無効はTerraformとWranglerで一致させる。
- D1、Queues、Cronなどのインフラは今後Terraformで追加し、必要なIDをWranglerのbinding設定へ渡す。
- LINEの秘密値はWorkers Secretsへ別途登録する。GitHubの配備トークンは既存WorkerのEditorに限定できる。
- サブドメイン名は`infra/production.auto.tfvars`でGit管理する。トークンとローカルstateは管理外。

## Consequences

初回はTerraform apply、アプリ配備、LINE Secret登録の順で準備する。
Worker本体だけではBotは動作しない。
GitHub ActionsにTerraform stateやインフラ管理権限を渡す必要がない。
同じWorkerへの配備はconcurrencyで直列化する。
GitHubへworkflowを登録するにはコミットとpushが必要であり、ローカルファイルの追加だけでは実行できない。
Terraformのstateは当面ローカルに保持し、共同運用開始前にリモートbackendへ移す。

## Enforcement

`pnpm verify`、`terraform validate`、`terraform plan`で検証する。
workflowにpushやpull_requestトリガーを追加しない。
初回配備後には再度planを実行し、アプリ配備による意図しない設定差分がないことを確認する。
