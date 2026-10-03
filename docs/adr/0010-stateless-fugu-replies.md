# ADR-0010: Fuguで記憶を持たないメンション応答を実装する

## Status

Accepted (2026-10-04)

## Context

家族グループで疎通ができたため、記憶機能に先立ってLLMを接続する。
通常のFuguを使い、Ultraは使わない。20秒では短いため、最大120秒の生成を許容する。
Replyは原則1分以内、Pushは月間通数を消費するので、期限内はReplyを優先する。
ADR-0006の疎通のみという範囲と、ADR-0008のconsumer未接続を変更する。

## Decision

- OpenAI SDKをinfrastructureに閉じ込め、SakanaのResponses APIと`fugu`固定で接続する。
- applicationはTextGenerator、ReplySender、GenerationQueueの契約を使う。
- 署名・グループ・メンション検証後にQueueへ投入し、投入完了後にWebhookへ200を返す。
- Terraformがconsumer接続を管理する。batch size 1、同時consumer 2、再試行0、失敗はDLQへ送る。
- 生成タイムアウト120秒、SDK再試行0、入力2,000 UTF-16単位、出力要求800トークンとする。
- 受信から45秒未満ならReplyを試みる。以降とReplyの400拒否はPushを使用する。
- 通信失敗や500など送信済みか不明なReplyエラーはPushへ切り替えない。
- Pushにはイベントごとに安定したUUIDのretry keyを付ける。
- D1に生成前のイベントIDを一意登録し、重複時は生成しない。本文や回答はD1へ保存しない。
- 7日より古いIDを次の処理時に削除し、10分より古いQueueジョブを処理しない。
- `FUGU_API_KEY`はWorkerの実行時Secret。pingとグループID取得は引き続きLLMなしで動く。
- 記憶・過去履歴・画像・外部ツールは追加しない。

## Consequences

通常の返信はLINEの通数を使わず、遅い回答だけPush枠を使う。
Queue/DLQは本文を一時保持するが、アプリには会話履歴を残さない。
生成前にIDを確保するため、中断時には回答が失われる場合がある。
生成済み回答を保存しないため自動再生成や確実な再送は行わず、新しいメンションで再実行する。
Sakana側の保持方針とAPI利用枠はサービス側の条件に依存する。
1件ごとの上限と同時実行制限はあるが、月額費用の厳密な上限ではない。
D1マイグレーション、queue handler配備、consumer作成の順で導入する。

## Enforcement

署名と許可判定、Queue投入前のLLM非実行、SDK送信内容、再試行なし、エラー秘匿、Reply/Push切替を単体テストする。
Workers上のD1で重複・並行claimとQueue処理を結合テストする。
`pnpm verify`とTerraform validate/planでコードと設定を検査する。

参考: [Sakana](https://console.sakana.ai/models)、[LINE](https://developers.line.biz/ja/docs/messaging-api/pricing/)、[Queues](https://developers.cloudflare.com/queues/platform/limits/)。
