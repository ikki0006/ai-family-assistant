# ADR-0012: Workers AIを予算制限付きAI Gateway経由で使う

## Status

Accepted (2026-10-04)

## Context

定額プランへの固執はなく、総額月1万円を目標に制限できれば従量課金を許容する。
Fuguの個人情報入力に関する規約を踏まえ、記憶導入前に推論先を変更する。
ADR-0010のFugu接続部分を置き換え、Queue・重複防止・Reply/Pushの構成は維持する。

## Decision

- Workers AIの`@cf/qwen/qwen3-30b-a3b-fp8`をAI bindingで呼ぶ。新しいAPIキーは使わない。
- AI GatewayをTerraformで管理する。全リクエストにGateway IDを指定し、未設定時は生成しない。
- 直近31日40 USD、直近24時間2 USD、1分10リクエストの制限を全用途で共有する。
- 通常のWorkers AI課金を使用し、Gatewayのプリペイドは使わない。
- 認証を有効化し、本文ログ・キャッシュ・Gatewayリトライを無効化する。
- Gatewayを通らない呼び出し、Fugu・別モデルへのフォールバック、アプリの自動再試行は行わない。
- 429は予算または利用回数の制限として案内する。生のエラーやプロンプトをログへ出さない。
- 最大生成120秒、最大出力800トークン、既存の同時consumer数2を維持する。
- Agents Sessionsは次の記憶実装で導入予定。この変更は記憶を持たない推論先の切り替えまで。

Gemini 3.8 Flashへの切り替えは後続タスクとし、Credits購入エラーの解消までは本ADRのQwenを使用する。

## Consequences

円建ての厳密な請求上限ではない。税・為替・インフラ料金に余裕を残し、USD予算を設定する。
Spend limitsはbest effortかつ結果整合であり、処理中の呼び出しで超過する場合がある。
無料枠を超える利用にはカード登録だけでなくWorkers Paidへの加入が必要。
予算停止中もLLMに依存しないゴミ出し通知は動く。
QwenとLlama 3.3の架空会話要約を実測し、両者の訂正反映を確認。Qwenの消費量が小さかったため採用するが、品質の網羅的な保証ではない。

## Enforcement

Gateway必須・ログ無効・429停止・再試行なし・エラー秘匿を単体テストする。
D1重複防止とQueue処理を結合テストし、`pnpm verify`を実行する。
Terraform planとCloudflare画面で予算・時間単位を確認する。

参考: [Spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)、[Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[モデル](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)。
