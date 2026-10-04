# ログとトラブルシュート

Workers LogsをTerraformとWranglerの両方で有効にし、配備後も設定が戻らないようにする。
疎通確認中はサンプリング率1（100%）、invocation logsと永続化を有効にする。
CloudflareのWorker画面のObservability → Logsで実行結果とアプリの構造化ログを確認する。
Workers Buildsのビルドログと、Workerの実行時ログは別のもの。

| event | 確認する内容 |
| --- | --- |
| `line_not_configured` | `issues`: `missing_channel_secret` / `missing_access_token` / `invalid_group_id` |
| `group_setup_required` | 初回取得した`groupId`を`LINE_ALLOWED_GROUP_ID`へ設定 |
| `invalid_signature` | Channel secretとWebhook送信元 |
| `invalid_payload` | WebhookのJSON形式 |
| `line_auth_failed` | LINE APIが401。アクセストークンの有効性・失効・チャネルの対応を確認 |
| `line_api_failed` | `upstreamStatus`。429ならレート制限など |
| `line_transport_failed` | LINE APIへの接続失敗・タイムアウト |
| `reply_failed` | 同じ実行のLINE API・通信エラー |
| `llm_not_configured` | `AI` bindingと`AI_GATEWAY_ID` |
| `llm_auth_failed` | Gatewayの認証とGoogle AI Studio Stored Keyの有効性・利用権限 |
| `llm_api_failed` | `upstreamStatus`。402/429ならGoogle・Gatewayの課金、予算、利用制限など |
| `llm_rate_or_budget_limited` | Gateway・Googleの残高、予算・回数制限。[AI運用](ai.md)を確認 |
| `reminder_operation_failed` / `garbage_reminder_failed` | D1 migration、設定有効期間、同じ実行のLINE・AIエラー |
| `llm_timeout` | 120秒以内に生成が完了しなかった |
| `llm_empty_response` / `llm_generation_failed` | 空の回答・応答形式・接続失敗 |
| `generation_job_failed` | D1テーブル、consumer設定、同じ実行のLINEエラーとDLQを確認 |
| `internal_error` | ハンドラ内の予期しない例外 |

通常は固定のevent名、設定不備の理由名、上流HTTPステータスのみを記録する。
トークンの有効性はLINE APIの返信リクエスト時に判定される。Webhook検証だけでは確認できない。
初回設定中だけ、明示的な取得コマンドに対してグループIDを記録する。設定後はIDを記録しない。
会話本文、user ID、署名、トークン、外部APIの応答本文、例外メッセージは出力しない。
Cloudflareのinvocation logsにはURLなどの実行メタデータが含まれるため、URLに秘密値を渡さない。
Tracesは今回有効にしない。

## 確認の順序

1. `/health`でWorkerの起動を確認する。200でもLINEやAIへの接続成功までは確認できない。
2. Webhook検証で署名と受信を確認する。続いて許可グループでメンション付きの`ping`を送る。
3. AI回答がない場合はQueue consumer、D1 migrations、GatewayのStored Key、実行ログを確認する。
4. 通知はCron、D1の状態・次回時刻、収集設定の有効期間を確認する。
5. 改善PRはGitHub Actionsの実行履歴を確認する。詳細は[自己改善](improvements.md)。
