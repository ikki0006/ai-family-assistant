# ADR-0016: Gemini 3.8 Flashを既存Gateway経由で使う

## Status

Accepted (2026-10-04)

## Context

通知の自然言語解釈と会話品質の改善のため、QwenからGeminiへの変更が依頼された。
モデル一覧に掲載されていることと、アカウントで課金して推論できることは別に検証する。

## Decision

- ADR-0012のモデル選択を置き換え、全用途に`gemini-3.8-flash`を指定する。
- AI bindingの`AI.gateway(id).run()`でprovider `google-ai-studio`とendpoint `v1beta/models/gemini-3.8-flash:generateContent`を明示する。`AI.run()`のモデル経由は使わない。既存の予算Gatewayを維持し、Google APIキーはアプリに追加しない。
- Google AI Studioの課金済みプロジェクトのキーをGatewayのStored Keysへ登録し、BYOKで使用する。aliasは`default`。キーはGit・Terraform state・Workerの環境変数に複製しない。Googleの呼び出し料金はGoogle側で支払う。
- GatewayはBYOK専用へ戻し、Cloudflare Creditsへのフォールバックを無効化する。Workers AIのpostpaid設定はCloudflareホストモデル向けなので維持する。
- 31日40 USD、24時間2 USD、60秒10件の制限、認証、本文ログ・キャッシュ無効を維持する。再試行・他モデルへのフォールバックは追加しない。
- モデル固有の変換はinfrastructureに閉じ込める。systemInstructionとcontentsへ変換し、assistantはmodelロールへ対応付ける。
- generationConfigはmaxOutputTokens=2048、thinkingLevel=low、includeThoughts=false。3.8 Flashはminimal非対応。旧Qwenの/no_thinkは削除する。
- candidatesの本文パートだけを採用し、thoughtパートは除外する。STOP以外の終了理由・空出力は失敗扱いとし、途切れたJSONで通知操作を実行しない。
- 402（残高不足）と429（予算・回数制限）を利用制限として扱い、生のプロバイダー応答や会話をログへ出さない。
- 本番モデルの切り替えは、予算Gateway経由の実API疎通が成功してから行う。

## Consequences

推論先はGoogleになる。Cloudflareホストモデルとは課金経路が異なる。
思考強度をlowにして普段遣いの遅延・費用を抑えつつ、出力には従来800より余裕を持たせる。
2026-10-04の確認では、自前キー必須による403はTerraformで解消したが、続いて残高不足の402が返った。
その後Google側の課金を有効化し、Stored Keysを登録した。同じStored Keyを使うGoogleネイティブGateway経路はHTTP 200だった。一方、AI binding試験はBYOK専用設定後も402。`AI.gateway(id).run()`からのネイティブ呼び出しでHTTP 200を確認し、この方式を採用する。Gemini配備は実API試験の成功後とする。購入や自動チャージの操作は行わない。

## Enforcement

単体テストでネイティブ入出力変換、思考パートの除外、不完全出力の拒否、402/429、予算経路固定、エラー秘匿を確認する。
会話・通知操作の統合テストをGemini形式の応答で実行し、`pnpm verify`を通す。

参考: [モデルと入出力](https://developers.cloudflare.com/ai/models/google/gemini-3.8-flash/)、[Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)、[思考設定](https://ai.google.dev/gemini-api/docs/generate-content/thinking)。
