# ADR-0006: 最初の機能をLINEのメンション疎通に絞る

## Status

Accepted (2026-10-04). Access control and setup amended by ADR-0009.

## Context

小さく動かし、LINEとCloudflareの接続を確認してから記憶や通知を追加したい。
グループでの返信はbot宛てのメンションがある場合に限定する。

## Decision

- `POST /webhooks/line`で受信し、本文の生バイト列に対して署名を検証してからJSONを解析する。
- `mention.mentionees`の`type: user`かつ`isSelf: true`をbot宛てのメンションとして扱う。
- メンション部分を除いた本文が`ping`なら`pong`と返信する。表示名の文字列や全員宛てメンションだけでは反応しない。
- 設定した所有者は、グループで`@bot グループID`を送り、登録に必要なIDを取得できる。
- グループID未登録時は所有者だけが疎通確認できる。登録後はそのグループのメンバーが呼びかけられる。
- 1対1では所有者の`ping`だけを受け付ける。room形式の旧複数人トークは対象外とする。
- 設定不足時はWebhookを503とし、`GET /health`だけを利用可能にする。
- ローカル秘密値は`.dev.vars`、見本は`.dev.vars.example`、本番はWorkers Secretsとする。
- 会話やトークンをログに出さず、DBにも保存しない。LLMも呼び出さない。
- 返信の完了を待ち、送信失敗時は502を返す。

## Consequences

この段階ではQueueも永続的なイベント重複排除も設けない。
LINEのreply tokenは一度だけ使用できるため、同じtokenの再送で返信を重ねない。
ただし複数イベントの一部だけ成功した場合やタイムアウト後の再配信で、使用済みtokenによる失敗が続く可能性がある。
次の状態変更機能を追加する前に、永続的なイベント処理記録と再試行を設計する。
全機能が実装済みの家族アシスタントとしては扱わない。

## Enforcement

署名、改ざん、メンション、所有者とグループの制限、設定不足、LINEエラーを単体テストで検査する。
Workers環境の結合テストと実LINE上の疎通は別々に確認する。

参考: [LINE署名検証](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)、[botへのメンション](https://developers.line.biz/en/docs/messaging-api/receiving-messages/#webhook-message-with-mention-to-bot)。
