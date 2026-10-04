# 初回設定・配備・運用

開発の起動手順は[README](../README.md)。設定の正本は[infra](../infra/)と[wrangler.jsonc](../wrangler.jsonc)。

## 管理範囲

| 対象 | 管理元 |
| --- | --- |
| Workerリソース、D1、Queue/DLQ、consumer、5分Cron、AI Gateway | Terraform |
| コード、bindings、DOクラスとmigration | Wrangler（通常はWorkers Builds） |
| D1テーブル | `migrations/`をWranglerで適用 |
| LINE等の実行時Secret | Workers Secrets |
| Googleキー | AI GatewayのStored Keys |
| GitHub接続・Build設定 | Workers Buildsの接続画面 |
| 家族固有の収集設定 | D1。GitやTerraformへ保存しない |

Queue consumerとCronをWranglerへ重複定義しない。TerraformはコードとSecretを管理しない。

## 認証・ローカル設定

`infra/terraform.tfvars.example`からGit管理外の`infra/terraform.tfvars`を作る。
公開サブドメイン設定は`infra/production.auto.tfvars`で管理する。別環境へ複製する場合はこの設定も見直す。

Git管理外の`.env.cloudflare`に`CLOUDFLARE_API_TOKEN`と`CLOUDFLARE_ACCOUNT_ID`を保存する。Terraformの`account_id`はtfvarsにも必要。

```sh
set -a
source .env.cloudflare
set +a
terraform -chdir=infra init
pnpm infra:fmt
pnpm infra:validate
```

Terraform用トークンは対象アカウントのWorker作成・管理、D1・Queues作成/編集、AI Gateway編集を許可するものを使う。workers.devのみならZone操作は不要。権限のUI名はCloudflareの[Workers認可](https://developers.cloudflare.com/workers/authorization/workers/)を参照する。管理トークンをWorker Secretや改善用Actionsへ渡さない。
stateとplanには設定情報が含まれるためGit管理しない。現在はローカルstateを想定しており、共同運用前にリモートstateへ移す。

## 初回構築の順序

新規環境ではconsumer・Cronより先に、`queue()`と`scheduled()`を持つアプリを配備する必要がある。
初回だけ基盤を選択して作り、最後に全体のplan/applyを行う。

```sh
terraform -chdir=infra plan \
  -target=cloudflare_worker.bot \
  -target=cloudflare_d1_database.family \
  -target=cloudflare_queue.jobs \
  -target=cloudflare_queue.dead_letter \
  -target=cloudflare_ai_gateway.family \
  -out=bootstrap.tfplan
terraform -chdir=infra apply bootstrap.tfplan
```

1. 作成されたDB ID、Worker/Queue名、Gateway IDを`wrangler.jsonc`と揃える。
2. `pnpm exec wrangler d1 migrations apply DB --remote`で未適用migrationを適用する。
3. Google AI Studioの課金プロジェクトのキーをGatewayのStored Keysへ、provider `google-ai-studio`・alias `default`で登録する。[AI運用](ai.md)を参照。
4. `pnpm verify`→`pnpm run deploy`で初回コードを配備する。DOはWranglerのmigrationで作るため手動作成しない。
5. 以下の全体plan/applyでconsumer・DLQ接続・Cronを反映する。
6. Workers SecretsとLINEを設定し、Workers BuildsへGitを接続する。

```sh
terraform -chdir=infra plan -out=deploy.tfplan
terraform -chdir=infra apply deploy.tfplan
```

既存環境で通常の変更を反映する際は、全体planを使う。初回用targetを常用しない。

## LINEとSecrets

```sh
pnpm exec wrangler secret put LINE_CHANNEL_SECRET
pnpm exec wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# グループID取得後
pnpm exec wrangler secret put LINE_ALLOWED_GROUP_ID
# 検索を使う場合
pnpm exec wrangler secret put TAVILY_API_KEY
```

秘密値は対話入力で登録する。自己改善の`GH_IMPROVEMENT_TOKEN`とGitHub側の設定は[自己改善](improvements.md)に記載する。

1. LINE公式アカウントのMessaging APIとグループ参加を有効化する。
2. Webhook URLを`https://<worker>.<subdomain>.workers.dev/webhooks/line`に設定する。
3. Webhook検証と利用を有効にし、定型の応答メッセージを無効にする。
4. 家族グループへbotを招待し、メンション候補からbotを選んで`@bot グループID`を送る。未設定時は返信しない。
5. Observability → Logsの`group_setup_required`にある`groupId`を`LINE_ALLOWED_GROUP_ID`へ登録する。
6. 同じグループで`@bot ping`→`pong`を確認し、通常の質問を試す。

文字列だけの@botや他人・全員宛てメンションはbot宛てと扱わない。グループIDは自動登録せず、取得コマンドでのみログに出す。設定後は許可グループの全メンバーが利用でき、1対1・別グループ・roomは対象外。`LINE_ALLOWED_USER_ID`や`FUGU_API_KEY`は現行アプリでは使わない。

## Workers Builds

WorkerのConnect to Gitから対象リポジトリを接続する。GitHub Appは対象リポジトリのみ許可する。アプリ配備にGitHub Actionsは使わない。

| 設定 | 値 |
| --- | --- |
| Production branch | `main` |
| Root directory | リポジトリルート |
| Build command | `pnpm install --frozen-lockfile && pnpm verify:app` |
| Deploy command | `pnpm run deploy` |
| 非本番ブランチの自動ビルド | 無効 |
| Build variable `NODE_VERSION` | `22.22.3` |
| Build variable `PNPM_VERSION` | `10.11.0` |
| Build variable `SKIP_DEPENDENCY_INSTALL` | `1` |

Build用の認証トークンと実行時Secretは別管理。`.env.cloudflare`はアップロードしない。
BuildではTerraform applyやDB migrationを行わない。push後はBuild履歴と`/health`を確認する。現在Git連携設定をTerraformで管理する実装はない。

## DB更新・旧版からの移行

```sh
pnpm exec wrangler d1 migrations list DB --remote
pnpm exec wrangler d1 migrations apply DB --remote
```

適用前に変更内容と稼働中のコードとの互換性を確認する。全未適用migrationが対象になる。
`0006_calendar_reminders.sql`以前の旧コードは列指定なしINSERTを使うため、移行時は旧9列を明示した互換版Worker→0006→新Workerの順に配備する。この移行は既存本番で実施済み。新規DBでは全migrationを適用してから最新アプリを配備する。
既存行・送信台帳は0006で保持する。新しい周期を含むDBへ旧Workerを戻さない。

## 回答とQueueの運用

通常の生成ではQueue保存後にWebhookへ200を返す。同期コマンドや改善確認は別経路で応答する。
受信後45秒未満ならReply、以降はPush。Replyの明確な400拒否もPushへ切り替えるが、通信失敗・500では二重送信を避けるため切り替えない。PushはLINEの通数枠を使う。

生成イベントIDはD1で先に確保し、同一イベントで再生成しない。古い生成ジョブは10分で対象外。再質問は新しいメンションとして送る。
Queueはbatch 1・同時consumer 2・`max_retries=0`。ハンドラは失敗時にretryを要求するが、Queueの設定に従いDLQへ送られる。通知は次のCron、記憶整理はリース切れ後のCronでも回収する。
Queue/DLQには本文を含めず、会話参照・グループID・reply tokenなどを保持する。必要に応じてDLQを確認・破棄する。

運用上のエラーは[トラブルシュート](troubleshooting.md)、費用は[AI運用](ai.md)、配備記録は[残タスク](remaining-tasks.md)から参照する。
