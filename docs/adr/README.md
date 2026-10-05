# Architecture Decision Records

ADRは「なぜそう決めたか」を残す履歴。現在の構成は[アーキテクチャ](../architecture.md)、起動・開発は[README](../../README.md)、操作・運用は[docs索引](../README.md)、詳細な記憶処理は[記憶仕様](../memory.md)を参照する。
Acceptedは設計の採用を示し、本番配備の完了は意味しない。配備状況は[残タスク](../remaining-tasks.md)で管理する。

## 現在の判断を探す

| 分野 | 基本となるADR | 補足・更新 |
| --- | --- | --- |
| レイヤーと共通型 | [0005: 小さなアプリの境界](0005-small-application-boundaries.md) | [0013: core](0013-shared-core.md)、[0015: 通知domain](0015-line-reminders.md) |
| 開発・配備 | [0002: 開発ツール](0002-development-tooling.md) | [0008: TerraformとWorkers Builds](0008-workers-builds-and-provisioned-resources.md) |
| LINEとアクセス制御 | [0009: 家族グループ限定](0009-group-only-access.md) | [0010: Reply/Push](0010-stateless-fugu-replies.md)、[0015: 引用返信・参加条件](0015-line-reminders.md) |
| AIと検索 | [0016: GeminiとBYOK](0016-gemini-flash.md) | [0012: 予算](0012-workers-ai-budget.md)、[0017: Tavily](0017-tavily-search.md) |
| 会話・記憶・削除 | [0019: 非同期整理と長期記憶](0019-background-memory.md) | [0021: DBとの分担](0021-conversation-tools-and-improvements.md)、[0014: Sessions](0014-conversation-sessions.md)、[0004: 個人情報の境界](0004-memory-and-privacy-boundaries.md) |
| 定期通知 | [0015: LINEからの通知管理](0015-line-reminders.md) | [0011: ゴミ出し](0011-garbage-reminders.md)、[0020: 暦と間隔](0020-calendar-reminders.md) |
| 自己改善 | [0018: 承認からDraft PR](0018-approved-improvements.md) | [0021: 自然文受付・修正範囲](0021-conversation-tools-and-improvements.md) |

## 判断の履歴

番号・ファイル名は参照を壊さないため変更しない。一部の判断だけ更新されたADRは、残る判断も併記する。

| ADR | 判断 | 状態・後続 |
| --- | --- | --- |
| [0001](0001-clean-architecture.md) | 当初のdomain層を含む構成 | 0005で置換 |
| [0002](0002-development-tooling.md) | pnpm・Biome・テスト基盤 | 採用 |
| [0003](0003-terraform-ownership.md) | Terraformの管理範囲 | 0007→0008で更新 |
| [0004](0004-memory-and-privacy-boundaries.md) | 記憶と個人情報の境界 | 採用。保存・削除の具体化は0014→0019 |
| [0005](0005-small-application-boundaries.md) | 小さなアプリのレイヤー | 採用。通知domainは0015で追加 |
| [0006](0006-line-connection-check.md) | LINE疎通確認 | 疎通手順。許可条件は0009、応答条件は0015で更新 |
| [0007](0007-manual-app-deployment.md) | 手動起動の配備 | 0008で置換 |
| [0008](0008-workers-builds-and-provisioned-resources.md) | Workers BuildsとTerraform | 採用 |
| [0009](0009-group-only-access.md) | 家族グループ限定 | 採用 |
| [0010](0010-stateless-fugu-replies.md) | Fugu・Queue・Reply/Push | Queueと配信方式は継続。モデルは0016、会話は0014→0019へ |
| [0011](0011-garbage-reminders.md) | D1の収集設定とPush | 採用 |
| [0012](0012-workers-ai-budget.md) | Gatewayと推論予算 | 予算は継続。モデル・課金経路は0016へ |
| [0013](0013-shared-core.md) | 層に依存しないcore | 採用 |
| [0014](0014-conversation-sessions.md) | Sessionsの短期履歴 | 保存基盤は継続。要約タイミング・長期記憶・削除範囲は0019へ |
| [0015](0015-line-reminders.md) | LINE通知管理と5分Cron | 周期は0020、参照は0021で更新 |
| [0016](0016-gemini-flash.md) | GeminiをBYOKで呼ぶ | 採用 |
| [0017](0017-tavily-search.md) | 必要時だけTavily検索 | 採用 |
| [0018](0018-approved-improvements.md) | 承認した改善をDraft PRにする | 受付・変更対象は0021で更新。隔離と承認方式は継続 |
| [0019](0019-background-memory.md) | 非同期整理・長期記憶・一覧 | 採用 |

| [0020](0020-calendar-reminders.md) | 月次・年次・間隔指定 | 採用 |

| [0021](0021-conversation-tools-and-improvements.md) | 必要時の予定参照・自然文の改善受付 | 採用 |

| [0022](0022-family-profiles.md) | 自動失効しない本人確認付きプロフィール | 採用 |

| [0023](0023-quick-replies.md) | 質問と改善承認のクイックリプライ | 採用 |

## 書き方

[template.md](template.md)の5項目を使い、判断・理由・主要な制約を簡潔に書く。
起動・開発コマンドはREADME、運用・費用・閾値・機能仕様はdocsへ置き、ADRからリンクする。
判断を変える場合は新しいADRを追加し、旧ADRに後続へのリンクを付ける。歴史的な判断を現在の実装に書き換えない。
`pnpm adr:lint`で必須項目と番号の重複を検査する。
