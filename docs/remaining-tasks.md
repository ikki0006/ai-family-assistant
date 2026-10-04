# 残タスク

2026-10-04時点。コードの実装と本番への反映は区別する。

## Geminiへの切り替え

- [x] `gemini-3.8-flash`の入出力変換・low思考・2048出力上限を実装。
- [x] Google AI Studioの有料プロジェクトとGatewayのStored Keys（Google AI Studio / default）を設定。
- [x] TerraformでGatewayを`byok_only=true`へ戻した。予算・認証・本文ログ無効を維持。
- [x] `AI.run()`経路は402のため、`AI.gateway(id).run()`のGoogleネイティブ経路に変更。追加Secret不要。
- [x] 実APIで架空の履歴訂正・18時の通知登録・雑談時の沈黙判定を確認（各約1〜2秒）。
- [ ] Workers Buildsで本番へ配備し、LINEから会話・通知操作を確認。

## ゴミ出し通知

- [x] `pnpm verify`成功。単体74件、Workers統合9件、型・依存検査・ビルドを確認。
- [x] 本番D1へマイグレーションと収集設定を反映。住所・実際の収集設定はGitに保存しない。
- [x] `048dc83`をWorkers Buildsで本番配備し、TerraformでCronを有効化。
- [ ] 前日23時・当日8時の通知を確認する。

## 記憶

- [x] Cloudflare Agents Sessionsによる短期履歴・必要時の要約・削除を実装。
- [ ] 本番配備後、通常発言の記憶とメンション回答・履歴リセットをLINEで確認する。
- [x] 非同期の短期要約・長期記憶抽出、更新、削除、期限切れ処理を実装（ADR-0019）。
- [x] LINEの記憶一覧・予定一覧・明示的保存・個別削除を実装。
- [x] D1 migration 0005と記憶整理を本番反映（2026-10-04、Worker `d70011ab-bcca-4532-aecf-c805e28506f3`）。配備用131テスト、health 200、5分Cronを確認。
- [ ] 本番で抽出の正確性、訂正・削除、一覧表示、回答への記憶反映を確認。

AI Gatewayの予算は31日40 USD・24時間2 USD。Geminiの料金はGoogle側へ課金される。実際の消費額はGoogle AI Studioでも確認する。

## LINEリマインド・会話への参加

- [x] 単発・毎日・毎週の登録、一覧、変更、停止、再開、削除を実装。
- [x] 5分Cron、Queue、送信前の状態照合、送信回ごとの再送キーを実装。
- [x] 通知提案への自発参加、botへの引用返信、スタンプ完全無視を実装。
- [ ] 本番LINEで登録・停止・再開・削除・引用返信・定刻Pushを確認。
- [ ] 締め切りタスクの期限・完了管理、月次・隔週ルールを実装。

## 最新の配備

- 2026-10-04: 非同期記憶整理・長期記憶・記憶/予定一覧を配備。[配備記録](releases/2026-10-04-memory.md)。
- 記憶配備時は自己改善を除外した。自己改善の最新状況は末尾の試行タスクを参照する。

## 自己改善（Geminiによる小規模試行）

- [x] プロンプト・単体テスト限定の生成をFuguからGemini/Gatewayへ変更。生成・検証・PR公開ジョブを分離。
- [x] Actions Secret `CF_IMPROVEMENT_GATEWAY_TOKEN`（専用AI Gateway Run）とvariable `CLOUDFLARE_ACCOUNT_ID`を設定。
- [x] GitHub ActionsによるPR作成を許可し、Worker Secret `GH_IMPROVEMENT_TOKEN`を登録。同じトークンで実dispatch成功。
- [ ] mainのブランチ保護を設定（現在は未設定）。Workflow自体は改善ブランチへのpushとDraft PR作成のみ。
- [x] migration 0004とWorkflowを反映、Worker `fbc51d37-ff57-49c0-afa8-9beae347a66d`を配備。health 200。
- [x] 専用トークンの実dispatch→Gemini生成→全検証→[Draft PR #1](https://github.com/ikki0006/ai-family-assistant/pull/1)作成成功。
- [ ] LINEから実際に要望・承認を送る操作を確認する（試験でLINEメッセージは送信していない）。
