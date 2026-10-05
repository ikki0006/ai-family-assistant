# 承認付き自己改善

## 依頼と承認

`@bot 改善: 回答をもっと短くするようにして`で仕様を確認し、家族グループのメンバーが「承認してPR作成」ボタンを選ぶとGitHub Actionsを起動する。
通常会話・会話記憶はGitHubに渡さず、承認した仕様だけを渡す。個人情報を仕様に含めないこと。
変更対象は`src/{application,domain,core,bootstrap,infrastructure}/`のTSと`tests/{unit,integration}/`のテスト、最大5ファイル。Geminiが既存の予算Gateway経由で1回生成し、検証を通った場合のみDraft PRを作る。機能全般の自動実装や自動mergeは行わない。

メンション付きの「〜を改良してプルリク上げて」も確認へ進む。自然文は改善・改良・修正・実装・変更の依頼とPR作成の語句を組み合わせたものに限定する。任意の自由文を理解する仕組みではないため、拾われなければ`改善: 具体的な仕様`を使う。単なる「OK」では起動せず、表示された改修内容に付いたクイックリプライで承認する。IDと版は内部で照合し、入力は不要。「キャンセル」で確認待ちの依頼を削除する。ボタンは24時間有効・一度限り。消えた場合は改善内容を再送する。

## 設定

1. `migrations/0004_improvements.sql`を含むD1 migrationを配備する。
2. GitHubのSettings → Developer settings → Personal access tokens → Fine-grained tokensで対象リポジトリだけを選び、ActionsをRead and writeにする。
3. Worker Secret `GH_IMPROVEMENT_TOKEN`にそのトークンを登録する。個人IDによる承認者制限は行わず、既存の許可済み家族グループに限定する。ローカルでは同名の`.dev.vars`を使う。
4. Cloudflareで対象アカウントの`AI Gateway → Run`だけを持つ専用APIトークンを発行する。GitHubリポジトリのSettings → Secrets and variables → Actions → Secretsへ`CF_IMPROVEMENT_GATEWAY_TOKEN`として登録する。同画面のVariablesへ`CLOUDFLARE_ACCOUNT_ID`を登録する。Googleキーは既存GatewayのStored Keys/defaultを使う。Terraform管理トークンはActionsに渡さない。
5. Settings → Actions → General → Workflow permissionsでGitHub ActionsによるPR作成を許可する。PR公開jobだけが`contents: write`と`pull-requests: write`を使う。
6. `.github/workflows/improvement.yml`をmainへ反映してから利用する。Workflow/ref/repositoryはコードで固定し、LINEから変更できない。

## 実行と結果の確認

承認期限は24時間。受付結果が不明なときは再送しないため、[実行履歴](https://github.com/ikki0006/ai-family-assistant/actions/workflows/improvement.yml)を確認する。
完成したPRの自動LINE通知は未対応。実行履歴とPull requestsから確認する。

## 実行制限

モデルは[AI運用](ai.md)のGeminiを使う。入力コード80,000文字まで、生成1回・120秒・出力8,000 tokenまで。検証失敗では停止し、自動修正・再試行・他モデルへのfallbackはしない。生成jobは5分、検証jobは10分、公開jobは5分で停止する。費用の共有範囲は[AI運用](ai.md)を参照する。専用トークンでもAI Gateway Run権限はアカウント内の全Gatewayに及ぶため、生成jobのみに渡す。

改善workflowの起動イベントは`workflow_dispatch`のみ。push・PR・scheduleでは起動しない。GitHubの仕様上、Actions権限付きAPIに加え、リポジトリ書込権限を持つユーザーの手動起動も可能。PAT単体でLINE由来を証明するものではない。main保護は別途設定する運用要件。設定済みとは仮定せず、[残タスク](remaining-tasks.md)で確認する。



## 生成できる範囲

許可パスは[scripts/improvement-agent/files.mjs](../scripts/improvement-agent/files.mjs)を正とする。router、Workerエントリーポイント、Workflow、生成スクリプト自身、依存設定、migrationは対象外。最大5ファイル・各30,000文字まで。入力に全文を含められなかったファイルは変更しないようモデルへ指示するが、生成内容は人間がレビューする。

PRタイトルとファイルごとの変更理由は日本語。本文には承認した要望、変更理由、検証結果、末尾に追跡IDを載せる。公開jobでは生成したコードを実行しない。

設計判断: [ADR-0018](adr/0018-approved-improvements.md)、[ADR-0021](adr/0021-conversation-tools-and-improvements.md)。予算は[AI運用](ai.md)を参照する。
