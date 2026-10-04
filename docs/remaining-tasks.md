# 残タスク

2026-10-04時点。コードの実装と本番への反映は区別する。

## Geminiへの切り替え

- [ ] AI Gateway Credits購入エラーを解消する。カード必須という表示が出るが、読み取りAPIではデフォルト支払い方法と支払い情報の存在を確認済み。原因は未確定。ユーザーの判断で調査をいったん保留する。
- [ ] Cloudflare Unified Billing経由の`google/gemini-3.8-flash`へ実装を変更する。現在の作業ツリーはQwen指定。
- [ ] Terraformの`byok_only`を変更し、Gateway認証・予算制限・本文ログ無効を維持する。
- [ ] Gemini向けの応答解析、出力・思考量制限、テスト、READMEとADRを更新する。
- [ ] Credits購入後に疎通確認し、アプリをデプロイする。購入や自動チャージの操作はユーザーが行う。

## ゴミ出し通知

- [x] `pnpm verify`成功。単体74件、Workers統合9件、型・依存検査・ビルドを確認。
- [x] 本番D1へマイグレーションと収集設定を反映。住所・実際の収集設定はGitに保存しない。
- [x] `048dc83`をWorkers Buildsで本番配備し、TerraformでCronを有効化。
- [ ] 前日23時・当日8時の通知を確認する。

## 記憶

- [ ] Cloudflare Agents Sessionsによる短期履歴とコンテキスト圧縮を実装する。
- [ ] 長期記憶への抽出、更新、削除の仕様を決めて実装する。

AI Gatewayの予算設定は作成済み。現在の推論先はWorkers AIのQwenで、Gateway経由の実API応答を確認済み。AI bindingからLINEへの一連の本番確認は別途必要。Geminiへの切り替えはCredits購入エラー解消後に行う。
