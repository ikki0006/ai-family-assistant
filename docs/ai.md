# AIの接続・予算・外部検索

ここに記す金額・回数はリポジトリの設定値。サービスの最新料金表や円建て請求上限を示すものではない。

## 接続とモデル

実装は[gemini-text-generator.ts](../src/infrastructure/ai/gemini-text-generator.ts)、設定は[infra/ai.tf](../infra/ai.tf)を正とする。
`gemini-3.8-flash`を`AI.gateway(id).run()`からGoogle AI Studioのネイティブエンドポイントへ送る。モデルの推論設定はlow、通常の最大出力は2048トークン。

Google AI StudioキーはAI GatewayのStored Keysにprovider `google-ai-studio`・alias `default`で登録する。WorkerにはAI bindingと`AI_GATEWAY_ID`を渡し、GoogleキーをWorkerやTerraformへ複製しない。
GatewayはBYOK専用・認証必須・本文ログとキャッシュ無効。Fuguや他プロバイダーへの自動fallbackはない。過去の試行経路は[ADR-0016](adr/0016-gemini-flash.md)に残す。

## 予算と課金の分離

| 設定 | 現在の値 | 管理元 |
| --- | --- | --- |
| 推論費用の制限 | 直近31日40 USD、直近24時間2 USD | `infra/ai.tf` |
| Gatewayリクエスト数 | 60秒あたり10回、sliding | `infra/ai.tf` |
| 家族の検索回数 | UTC暦月900回 | `reserveSearch` |

会話、検索要否判定、通知操作判定、記憶整理、自己改善の推論は同じGateway予算を共有する。月初リセットではなくsliding window。制限時に別経路へ迂回しない。

推論はGoogle側への課金、Worker・D1・Queues・DOはCloudflare側、検索はTavily側、自己改善の実行時間はGitHub側で確認する。このBYOK経路はCloudflare AI Gateway Creditsを使わない。Workersプラン代にGoogleの推論代を含めて扱わない。

月1万円という運用目標に対し余裕を残した設定であり、税・為替・インフラ料金まで含めた厳密な上限ではない。Gatewayの費用集計や実行中の呼び出しによる超過も考慮する。予算変更はTerraformのplan/applyで反映する。

## 回答の実行制限

通常回答は最大120秒、通知の操作判定は最大30秒。長期記憶整理は別ジョブで最大60秒。短い生成はReply、受信後45秒以降はPushで送る。PushとReplyの切替や再送制約は[運用手順](deployment.md#回答とqueueの運用)を参照する。

ローカルの統合テストではAIをモックする。`pnpm dev`から実AI bindingを使う場合はリモートへの呼び出しになる。外部サービスのデータ利用・保持条件は各契約で確認し、アプリ内の削除と混同しない。

## Web検索（Tavily）

ローカルは`.dev.vars`の`TAVILY_API_KEY`、本番は`pnpm exec wrangler secret put TAVILY_API_KEY`で登録する。
会話メモリを使う通常回答で、Geminiが検索の必要性を判断する。通知・要約では検索しない。
Basic検索を1回答1回、最大5件、1家族あたりUTC暦月900回までに制限する。失敗も使用回数に含む。
Tavilyキーを他用途で使う分は含まないため、無料枠を守る場合はTavily側の従量課金も無効のままにする。
検索本文は保存せず、検索日・参考URL付きの回答を通常の7日履歴に保存する。
検索には最新の発言から作った検索語だけを送る。モデルに私的情報の除外を指示するが完全な匿名化は保証しない。
キー未登録の場合は従来どおり検索なしで回答する。

設計判断: [ADR-0012](adr/0012-workers-ai-budget.md)、[ADR-0016](adr/0016-gemini-flash.md)、[ADR-0017](adr/0017-tavily-search.md)。
