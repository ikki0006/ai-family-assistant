# Architecture Decision Records

設計判断の理由と制約を記録する。
実装手順はルートのREADME、全体構成は[architecture.md](../architecture.md)に置く。

| ADR | 内容 | 状態 |
| --- | --- | --- |
| [0001](0001-clean-architecture.md) | 当初のdomain層を含む構成 | Superseded by 0005 |
| [0002](0002-development-tooling.md) | pnpm、Biome、Vite、テスト基盤 | Accepted |
| [0003](0003-terraform-ownership.md) | Terraformと開発ツールの管理範囲 | Superseded by 0007 |
| [0004](0004-memory-and-privacy-boundaries.md) | 記憶と個人情報処理の境界 | Accepted |
| [0005](0005-small-application-boundaries.md) | domain層を省き、処理と外部接続を分離 | Accepted |
| [0006](0006-line-connection-check.md) | メンションによるLINE疎通確認 | Accepted |
| [0007](0007-manual-app-deployment.md) | Terraformと手動起動のアプリ配備を分離 | Superseded by 0008 |
| [0008](0008-workers-builds-and-provisioned-resources.md) | Workers BuildsとDB・Queueの先行作成 | Accepted |
| [0009](0009-group-only-access.md) | 家族グループ限定のアクセス | Accepted |
| [0010](0010-stateless-fugu-replies.md) | Queue経由のFugu応答とReply/Push切替 | Accepted |
| [0011](0011-garbage-reminders.md) | D1の収集設定と定期Push | Accepted |
| [0012](0012-workers-ai-budget.md) | Workers AIとGatewayによる予算制限 | Accepted |
| [0013](0013-shared-core.md) | 層に依存しない共通定義の配置 | Accepted |

| [0014](0014-conversation-sessions.md) | Sessionsによる短期会話・要約・削除 | Accepted |

新規の判断は[template.md](template.md)を使い、4桁の番号とkebab-caseの名前を付ける。
状態はProposed、Accepted、Deprecated、Supersededから選ぶ。
判断を覆す場合は新しいADRを追加し、旧ADRから参照する。
`pnpm adr:lint`で必須見出しと番号の重複を検査する。

既存プロジェクト`recruta-ai-interview`のADR運用を参考にした。
このプロジェクトでは依存方向の検査にdependency-cruiserを使い、ADRに対応する検査コマンドを記載する。

- [ADR-0015: LINEから通知を管理し5分間隔で実行する](0015-line-reminders.md)
