# AI Family Assistant

家族のLINEグループで会話の記憶と通知を扱うアシスタント。
現在はヘルスチェック、`@bot ping`の疎通確認、許可した家族グループでのメンションに対するGeminiの回答を実装している。
会話は家族ごとのDurable Object内のAgents Sessionsに7日間保存する。D1には重複生成防止ID、収集設定、通知済み記録を保存する。

- [ディレクトリ構成と責務](docs/architecture.md)
- [設計判断の一覧](docs/adr/README.md)
- [残タスク](docs/remaining-tasks.md)

層に依存しない共通型は`src/core`に置く。coreはapplicationや外部SDKに依存せず、将来のdomainからも参照できる。

## 開発環境

Nodeとpnpmの標準バージョンは`.mise.toml`、pnpmの固定バージョンは`package.json`に記載する。
`mise install`で合わせるか、同じバージョンを手動で用意する。

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm hooks:install
pnpm dev
```

初回の依存解決後に生成される`pnpm-lock.yaml`をコミットする。
以後のCIと再インストールには`pnpm install --frozen-lockfile`を使う。
依存パッケージを取得できない環境では、設定ファイルの作成と全ツールの動作検証を区別する。

`.dev.vars`にLINEのChannel secret、Channel access tokenを設定し、下記の初回手順で家族グループのIDを登録する。
アプリは`.env`を併用せず、本番ではWorkers Secretsを使う。
設定不足時はWebhookが503を返すが、ローカルURLの`/health`にはアクセスできる。
架空のデータだけをテストに使い、実際の会話やAPIキーをfixtureに保存しない。

## 最初の動作確認

1. LINE公式アカウントのMessaging APIとグループへの参加を有効化する。
2. Workerを配備し、LINE設定のWebhook URLを`https://<worker>.<subdomain>.workers.dev/webhooks/line`にする。
3. 下記の手順でWorkers Secretsを登録する。
4. LINEのWebhook検証と利用を有効にし、定型の応答メッセージは無効にする。
5. 家族グループにbotを招待し、メンション候補からbotを選んで`@bot グループID`と送る。この段階では返信しない。
6. WorkerのObservability → Logsで`group_setup_required`を探し、`groupId`を`LINE_ALLOWED_GROUP_ID`へ設定する。自動登録は行わない。
7. 同じグループで`@bot ping`と送り、`pong`が返ることを確認する。家族の誰でも呼びかけられる。

`@bot`は例示であり、LINEのメンション候補から実際のbotを選択する。
文字列だけの@bot、他人宛て・全員宛てのメンションはbot宛てとして扱わない。通知関連の自発参加は別に判定する。
グループID未設定時は返信せず、署名検証済みの取得コマンドに限ってIDをログへ出す。
設定後は指定グループだけに返信し、1対1・別グループ・roomでは反応しない。
`LINE_ALLOWED_USER_ID`は不要。以前登録した場合は削除できる。
ローカルのlocalhostへLINEから直接接続はできないため、実LINEの確認には公開したHTTPS URLが必要になる。

## Geminiの設定と動作

Terraformの`cloudflare_ai_gateway.family`を先に適用し、Workers BuildsでAI binding付きのWorkerを配備する。
`AI_GATEWAY_ID`は非秘密の設定。CloudflareのAI bindingを使うので、実行時のAI APIキーは不要。
モデルは`gemini-3.8-flash`。`AI.gateway(id).run()`からGoogle AI Studioのネイティブエンドポイントを呼ぶ。Fuguや他のプロバイダーへの自動フォールバックはしない。
以前の`FUGU_API_KEY`は参照しないため、切り替え確認後に削除できる。

Gatewayは本文ログ・キャッシュを無効化し、認証を必須にする。
Google AI Studioの課金済みプロジェクトのキーをGatewayのStored Keysへ、provider `google-ai-studio`・alias `default`で登録する。Google側へ課金され、Cloudflare Creditsは使わない。GatewayはBYOK専用。GoogleキーをWorkerやTerraformへ複製しない。
ローカルテストはAI bindingをモックする。本番AIを使う開発時は費用が発生する。

### AI予算

- 全モデル・全用途の合計で、直近31日40 USD、直近24時間2 USDのSpend limits。
- APIの金額単位はUSD、時間窓は秒。Cloudflare画面でも40ドル/31日、2ドル/日と表示されることを確認済み。
- 月1万円の総額目標に対し、税・為替・Workers/D1/Queues/DO料金の余裕を残す。円建て請求の厳密な上限保証ではない。
- 予算は月初リセットではなくsliding window。予算または回数制限時は429を扱い、AIを迂回して呼ばない。
- Gatewayの費用計算はbest effortで、実行中リクエストなどで多少超過し得る。入力・出力・同時実行も制限する。
- 返信と非同期の記憶整理は必ず同じGatewayを使用する。短期記憶の要約も同じ予算内で処理する。
- Gatewayの設定は`infra/ai.tf`を変更してTerraformで適用する。

- `@bot 今日の晩ごはんの案を3つ教えて`のように、メンションと本文を送る。
- 署名・許可グループを検証し、メンション・botへの引用返信・通知の参加候補をQueueへ渡す。Queueへの保存完了後にWebhookへ200を返す。
- Queue consumerで最大120秒生成する。入力は2,000 UTF-16コード単位、生成リクエストは最大2048出力トークン、LINE表示は最大2,000 Unicodeコードポイントに制限する。
- 受信から45秒未満で完成した場合はReply、以降はPushを使う。Replyの明確な400拒否もPushへ切り替えるが、通信失敗や500では二重送信を避けるため切り替えない。
- PushはLINEの月間送信枠を受信人数分消費する。Replyは通数に含まれない。
- 通常発言を含めた直近の会話と必要時の要約を回答に利用する。画像や添付ファイル、外部ツールは対象外。
- AI binding・Gateway未設定や生成失敗時には短い案内を返信する。`ping`はLLMを呼ばず動作する。
- アプリとQueueの自動再試行は無効。同時consumer数は2。月額料金そのものの上限保証ではない。

本文と回答はDOのSQLiteへ保存し、アプリログには残さない。Queueには会話ID・削除世代・group ID・reply tokenを一時保持し、本文は含めない。
未処理の古いジョブは10分で処理対象外とする。失敗ジョブはDLQに入り、Queueの保持期間が終わるまで残るため、必要に応じて手動で破棄する。
D1の重複防止IDは生成前に確保し、7日を超えた記録を次のジョブ処理時に削除する。
処理中断や送信失敗後も同じイベントでは再生成しない。再実行は新しいメンションで行う。
この設計では回答の確実な再送までは保証しない。Google有料APIの入力・出力は製品改善に使われないが、不正利用検知等の保存は別に存在する。

### 初回配備順序

1. `pnpm exec wrangler d1 migrations apply DB --remote`で処理ID用テーブルを作る。
2. mainへのpushで、`queue()`を持つWorkerをWorkers Buildsから配備する。
3. Terraformのplan/applyでQueue consumerとDLQへの接続を作る。
4. TerraformでAI Gatewayを作成してからAI binding付きWorkerを配備し、家族グループからメンションで確認する。

consumerはTerraformが管理し、Wranglerにはproducer bindingだけを置く。
`pnpm dev`だけではconsumerを接続しないため、ローカルの生成・Queue処理は`pnpm test:workers`で検証する。

参考: [Workers AI](https://developers.cloudflare.com/workers-ai/)、[Spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)、[LINEの通数](https://developers.line.biz/ja/docs/messaging-api/pricing/)。

## 品質チェック

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | Biome、依存方向、ADR形式を検査。ファイルを書き換えない |
| `pnpm check:lint` | Lintだけ実行 |
| `pnpm check:format` | 整形の差分だけ検査 |
| `pnpm fix` | Biomeで安全な自動修正と整形 |
| `pnpm format` | 整形だけ実行 |
| `pnpm typecheck` | 通常の型検査と、外部ランタイム型を除外したcoreの型検査 |
| `pnpm test` | Node環境の単体テスト |
| `pnpm test:workers` | Workers環境の結合テスト |
| `pnpm verify` | 全チェック、テスト、ビルド、Terraform書式を検査 |

Biomeはタブ幅2、行幅100で、名前付きexportを基本とする。
`.vscode/settings.json`で保存時のBiome整形を設定している。
Lefthookは設定済みだが、Gitフックへの登録には`pnpm hooks:install`が必要。

## インフラ

CloudflareリソースはTerraform、アプリ配備はWorkers BuildsからWranglerで管理する。
`infra/`にWorker、公開設定、D1、ジョブ用Queue、DLQを定義する。
D1の`DB` bindingと通常Queueの`JOBS_QUEUE` producerをwrangler.jsoncに設定している。
bindingはアプリ配備で反映される。D1には生成イベントIDのテーブルを作り、Queue consumerとDLQ接続はTerraformで管理する。ゴミ出し通知のCronもTerraformで管理する。
詳細は[ADR-0008](docs/adr/0008-workers-builds-and-provisioned-resources.md)を参照する。

```sh
terraform -chdir=infra init -backend=false
pnpm infra:fmt
pnpm infra:validate
```

実際に配備するときは、`infra/terraform.tfvars.example`を`infra/terraform.tfvars`へコピーして設定する。
サブドメイン名は公開情報なので`infra/production.auto.tfvars`でGit管理する。
Terraform用の`CLOUDFLARE_API_TOKEN`はシェルかCIへ設定し、`.dev.vars`やWorkerへ渡さない。
ローカルではGit管理外の`.env.cloudflare`にexport形式で保存し、`source .env.cloudflare`で読み込む。
CloudflareのAPIトークン作成画面で「Start from scratch」からカスタム権限を設定する。
現在の構成で必要な権限と対象範囲は次のとおり。

| 設定 | 値 |
| --- | --- |
| Workersのロール | Admin |
| スコープ | 使用するアカウントのWorkers product（Workers全体） |
| Zoneの権限 | 不要（workers.devを使用） |

[現行のWorkers権限体系](https://developers.cloudflare.com/workers/authorization/workers/)では、新規Workerの作成にはWorkers productスコープのAdminが必要。
Editorは既存Workerの更新・配備・Secret管理に使えるが、新規作成や削除はできない。
Workers ScriptsはLegacy権限であり、新規設定では新しいWorkersロールを使用する。
D1とQueuesにも作成・編集権限が必要。Workersの権限だけではDBを作成できない。
Wrangler用に`CLOUDFLARE_ACCOUNT_ID`もシェルかCIへ設定し、`infra/terraform.tfvars`の`account_id`と揃える。
Terraformの`account_id`はtfvarsから渡すため、環境変数だけでは設定されない。

最初はローカルstateなので、共同運用する前にリモートstateを設定する。

```sh
source .env.cloudflare
terraform -chdir=infra plan -out=deploy.tfplan
terraform -chdir=infra apply deploy.tfplan
# 初回のアプリ配備をWorkers Buildsで実行してから、以下を登録する
pnpm exec wrangler secret put LINE_CHANNEL_SECRET
pnpm exec wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# グループID取得後
pnpm exec wrangler secret put LINE_ALLOWED_GROUP_ID
```

秘密値は各コマンドの対話入力で登録する。
Worker名を変更した場合は、wrangler.jsoncとTerraformのworker_nameを揃える。
TerraformはコードとSecretを管理しないため、アプリ配備を巻き戻さない。
初回アプリ配備後にはTerraform planを再実行し、意図しない設定差分がないことを確認する。

## ログとトラブルシュート

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
| `llm_auth_failed` | Sakana APIキーの有効性・利用権限 |
| `llm_api_failed` | `upstreamStatus`。429ならSakanaの利用制限など |
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

## Workers Buildsでpush時に配備する

CloudflareのWorker画面のConnect to Gitから`ikki0006/ai-family-assistant`を接続する。
GitHub Appの初回認可では対象リポジトリだけを許可する。
GitHub Actionsの配備workflowは使用しない。

| 設定 | 値 |
| --- | --- |
| Production branch | `main` |
| Root directory | リポジトリルート |
| Build command | `pnpm install --frozen-lockfile && pnpm verify:app` |
| Deploy command | `pnpm run deploy` |
| 非本番ブランチの自動ビルド | 無効 |
| Build variable: `NODE_VERSION` | `22.22.3`（`.node-version`にも記載） |
| Build variable: `PNPM_VERSION` | `10.11.0` |
| Build variable: `SKIP_DEPENDENCY_INSTALL` | `1` |

Lint、型検査、テスト、ビルドが成功してから配備する。
`verify:app`はTerraform不要で、ローカルの`verify`はTerraform書式検査も行う。
ビルド時にTerraform applyやDBマイグレーションは実行しない。
Buildの認証トークンはCloudflareの接続画面で設定し、LINEの秘密値は実行時のWorkers Secretsへ登録する。
`.env.cloudflare`はGitやビルド環境にアップロードしない。
コードをmainへpushした後、CloudflareのBuild履歴と`/health`応答を確認する。

Cloudflare provider 5.26.0にはWorkers Builds接続用の専用リソースがないため、接続設定はこの手順で管理する。
初回のGitHub App認可後は[Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)で接続・トリガー・ビルド変数を管理できるが、Terraformによる自動管理は未実装。

参考: [Workers Builds設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[ビルド環境のバージョン指定](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

参考: [署名検証](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)、[メンション情報](https://developers.line.biz/en/docs/messaging-api/receiving-messages/#webhook-message-with-mention-to-bot)、[Workersのローカル環境変数](https://developers.cloudflare.com/workers/local-development/environment-variables/)。

## ゴミ出し通知

収集日の前日23時・当日8時（JST）に、許可済み家族グループへPushする。LLMは使わない。
TerraformがCron `*/5 * * * *`を管理する。ゴミ出しは23時・8時の0分・5分・10分だけ対象とする。5分・10分後は失敗時の再試行用で、送信済みなら何もしない。
LINE retry keyとD1の送信済み記録で重複を防止する。送信済み記録は90日後に次の成功時に整理する。

収集設定はD1の`garbage_schedule`のid=1、`config_json`に平文JSONで保存する。
町名・丁目は保存しない。実際の曜日・週番号や例外日はGitに入れず、本番D1にパラメーター付きSQLで登録する。
マイグレーションにはテーブル定義だけを含める。例示・テストは架空の品目と曜日だけを使う。

設定形式（架空例）:

```json
{
  "validFrom": "2026-04-01",
  "validThrough": "2027-03-31",
  "rules": [{ "label": "架空品目", "weekday": 2, "weeks": [2, 4] }],
  "overrides": { "2027-01-01": [] }
}
```

曜日は日曜0〜土曜6、weeks省略は毎週。overridesはその日全体を置き換え、空配列は収集なし。
設定の有効期間外は送らないため、年度切り替え前に更新する。
12月31日〜1月3日は例外未登録なら通常曜日の通知をせず、特別日程の確認を促す。
当日8時は最終確認であり、収集期限を延ばすものではない。

配備順序: D1マイグレーション → 本番設定登録 → scheduled handler配備 → Terraform Cron適用。
WranglerにはCronを定義せず、Terraformを唯一の管理元にする。

## 短期会話と秘書プロンプト

- 許可グループの通常のテキスト発言も保存する。返信はbotへのメンション・引用返信、および必要時の通知提案。
- `application/prompts/secretary.ts`で役割、口調、使える機能を管理する。家族固有の事実や住所は書かない。
- `application/prompts/organize-memory.ts`は非同期の要約・長期記憶抽出指示。
- 元の会話は7日間保持する。期限超過は参照対象から除き、受信・参照時または毎時のalarmで削除する。
- 質問時刻以前の直近300件を候補に、直近の会話と日別要約を使う。入力は日本語を保守的に数えるUTF-8予算8,000 bytes以内。
- 回答前には要約しない。5分Cronで未処理会話を確認し、15分静かになった場合または最古の未処理会話が1時間前の場合に、Queueで要約と長期記憶抽出を行う。未処理会話がなければ推論しない。
- LINEの送信取消で原文・要約・関連し得るbot回答を削除する。`@bot 履歴リセット`は短期履歴と長期記憶を消す。登録済み通知は残す。
- 削除前の待機ジョブや生成中の回答から記憶を復活させない。取消IDなど本文なしの削除記録は8日保持する。
- DBでの削除はLINE上のメッセージや外部サービスのバックアップまで消すものではない。
- `CONVERSATIONS` bindingと`v1-conversations` SQLite migrationをWorkers Buildsで配備する。DOを画面で手動作成する必要はない。
- Agents SDKの依存に合わせ、ローカルとBuildsはNode 22.22.3以上の22系を使う。

動作確認は、まずメンションなしで架空の予定を書き、次にメンションでその予定を質問する。
続いて元の発言を送信取消し、または`@bot 履歴リセット`して、その情報を参照しなくなることを確認する。
長期記憶はD1へ平文で保存し、通常会話から明確な好み・習慣などを抽出する。根拠となるユーザー発言IDを保持し、訂正・有効期限・送信取消を反映する。原文の7日保持とは別に残る。最大200件。詳細は[ADR-0019](docs/adr/0019-background-memory.md)。

botへメンション、またはbotへの引用返信で利用する。

- `何を覚えてる？` / `記憶一覧`：保存済みの長期記憶を表示。4件ずつ、`記憶一覧 2`で次ページ。
- `予定一覧`：登録済み通知の有効・停止・完了状態、ゴミ出しの収集ルールと通知時刻を表示。`予定一覧 2`で次ページ。
- `覚えて: 朝は紅茶が好き`：300文字以内の内容を即時保存。
- `記憶削除 ID`：一覧のIDを指定。根拠の発言と派生要約・回答、同じ発言を根拠に持つ記憶も削除する。
- `記憶全消去`：会話・要約・長期記憶を消去。通知は削除しない。

一覧表示・明示的保存・削除ではLLMを呼ばない。自動整理前の発言は長期記憶一覧にはまだ出ない。曖昧な自由文の保存・削除は即時反映されないため上記の書式を使う。
回答に渡す長期記憶は簡易キーワード順位で最大8件・1,800 bytes、既存の8,000 bytes入力枠内に含める。
本番反映には `migrations/0005_long_term_memories.sql` の適用が先に必要。新しいSecretやTerraformリソースは不要。

## LINEからのリマインド

単発・毎日・毎週の通知をLINEから管理できます。日本時間、最大100件です。

- 「今日18時に夕飯をリマインドして」
- 「毎週火曜20時に買い物をリマインドして」
- 「リマインド一覧」「買い物の通知を水曜20時に変更して」
- 「買い物の通知を停止して」「買い物の通知を再開して」「買い物の通知を削除して」

Cronは5分間隔です。通常0〜5分程度遅れて届きます。通知の実行にはLLMを使いません。
過去の単発日時は登録しません。日付が不明なときは確認します。
通知は会話と独立して保存され、7日間の保持期限や「履歴リセット」では消えません。削除は通知ごとに依頼してください。
タスクの完了管理・月次や隔週の通知・既存ゴミ出し設定の会話からの変更は未対応です。

メンションまたはbotの発言へのLINEリプライで回答します。引用されたbotの発言は、この対応開始後に送った直近7日以内のものを識別できます。
メンションのない予定・期限の話にも必要時だけ通知を提案します。通常の候補判定は最短1分、提案は最短30分間隔で、会話から自動的に通知を作ることはありません。明確な通知依頼はメンションなしでも操作します。
スタンプはすべて保存・推論・返信の対象外です。他人へのリプライに無条件で割り込むこともありません。

配備順はD1の`0003_reminders.sql`適用 → Workers Buildsでアプリ配備 → TerraformでCron変更です。新しいSecretは不要です。

## Geminiの接続経路

`gemini-3.8-flash`のネイティブ形式を使用しています（[ADR-0016](docs/adr/0016-gemini-flash.md)）。
通常回答・要約・通知判定で同じGatewayの予算を共有します。thinkingLevelはlow、maxOutputTokensは2048です。
Geminiの料金はGoogle AI Studioの有料プロジェクトに課金します。GatewayのStored KeysにGoogle AI Studioキーをalias `default`で登録します。Workers Paidの基本料金には含まれません。
`AI.run()`によるモデル指定ではBYOK登録後も402になったため、`AI.gateway(id).run()`にproviderとGoogle専用endpointを明示します。
GoogleのStored Keysを使う経路でHTTP 200を確認済みです。新しいWorker Secretは不要です。

### Web検索（Tavily）

ローカルは`.dev.vars`の`TAVILY_API_KEY`、本番は`pnpm exec wrangler secret put TAVILY_API_KEY`で登録する。
会話メモリを使う通常回答で、Geminiが検索の必要性を判断する。通知・要約では検索しない。
Basic検索を1回答1回、最大5件、1家族あたりUTC暦月900回までに制限する。失敗も使用回数に含む。
Tavilyキーを他用途で使う分は含まないため、無料枠を守る場合はTavily側の従量課金も無効のままにする。
検索本文は保存せず、検索日・参考URL付きの回答を通常の7日履歴に保存する。
検索には最新の発言から作った検索語だけを送る。モデルに私的情報の除外を指示するが完全な匿名化は保証しない。
キー未登録の場合は従来どおり検索なしで回答する。検索機能の追加だけでは本番Secretの登録・配備は行われない。

リマインドは登録時に「何をするか」が分かる通知文を生成・保存し、定刻にはその文をAI呼び出しなしで送る。日時だけの返信でも直前の行動を引き継ぐ。以前の短いラベルには行動情報がないため、自動で推測・書き換えず必要に応じて通知内容を変更する。
