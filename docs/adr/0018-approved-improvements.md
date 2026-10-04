# ADR-0018: LINEで承認した改善を隔離したGitHub ActionsでDraft PRにする

## Status

Accepted (2026-10-04)

## Context

家族の要望から小さな改善PRを作りたい。Workerには対象リポジトリのActions:writeのみを渡し、実装は既存Geminiを従量課金で使い、追加サブスクリプションを契約しない。

## Decision

- 明示メンションの「改善: 仕様」で確認文を作り、「改善承認 ID 版」を許可済み家族グループのメンバーが承認する。自然言語の聞き取りは後続。仕様本文だけをGitHubと実装AIに渡すことを確認文に明記する。会話履歴・本番データ・Secretsは渡さない。
- D1に仕様・版・状態を保存する。承認は作成から24時間以内。条件付きUPDATEでpendingからdispatchingを原子的に取得し、通信結果不明時にはuncertainとし自動再送しない。プロセス中断でdispatchingが残った場合も手動確認する。
- 起動はworkflow_dispatchのみ。push・PR・scheduleからは起動しない。権限付きAPIと本人のGitHub手動起動を許容する。mainの保護ルールは別途設定し、Actions botも直接更新できないようにする。
- GitHub宛先はikki0006/ai-family-assistant、main、improvement.ymlに固定する。WorkerのGH_IMPROVEMENT_TOKENは対象リポジトリのみActions:writeのfine-grained PATとする。個人IDによる承認者制限は設けない。
- 実装はGemini 3.8 Flashを既存AI GatewayのGoogle AI Studioネイティブ経路・Stored Keys defaultで呼ぶ。専用のAI Gateway RunトークンをActions Secret `CF_IMPROVEMENT_GATEWAY_TOKEN`へ置く。Terraform管理トークンやGoogleキーは渡さない。アカウントIDはRepository variable `CLOUDFLARE_ACCOUNT_ID`で指定する。
- 1依頼1回、入力コード80,000文字まで、120秒、8,000出力token、low思考に固定する。予算制限・ログ無効・キャッシュ無効を維持し、他モデルへのfallback・自動再試行・失敗後の修正ループは行わない。会話とGateway予算を共有する。

- 初版はsrc/application/prompts直下のTSとtests/unit直下のtest.tsを最大5ファイルだけ変更できる。JSONでファイル全文を生成し、パスとサイズを検証する。生成物を生成jobで実行しない。
- 別の検証jobはAIキー・本番Secrets・GitHub書込権限を持たずpnpm verifyを実行する。publish jobは検証済みartifactを再検証して反映するだけで生成コードを実行せず、Draft PRを作る。mainへの自動mergeはしない。
- プロンプト変更も悪意ある振る舞いを含み得るため人間のレビューを必要とする。テスト成功は内容の安全性や正しさの保証ではない。
- 完成PRリンクのLINE通知、自由なコード変更、実装の反復修正、期限タスク化は後続。初版ではGitHub ActionsとPR一覧で結果を確認する。

## Consequences

新しい常駐インフラなしで改善ループを試せる。大半の機能追加は初版の変更可能範囲外であり失敗終了する。Googleの従量料金とGitHub Actions利用料金が発生する。AI Gateway Run権限はアカウント内のGateway全体に及ぶため、専用トークンを生成jobだけへ渡す。承認仕様はGitHub実行入力に保持され、公開リポジトリでは第三者が閲覧し得る。

## Enforcement

グループ境界・版・重複・不明応答・固定dispatch宛先を単体テストする。D1 migrationを配備前に適用する。GitHubのActionsによるPR作成をリポジトリ設定で許可する。秘密値なしのpnpm verifyとパス許可リストで変更範囲を検証する。

参照: [AI Gateway認証](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)、[Google AI Studio経路](https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/)。
