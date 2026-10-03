# アーキテクチャ

application、infrastructure、presentation、bootstrapからなる単一のCloudflare Worker。
現在の機能はヘルスチェック、LINE疎通確認、記憶を持たないFuguへの質問と回答。
記憶と定期通知はまだ実装していない。
TerraformでD1、ジョブ用Queue、DLQを先に定義し、アプリ配備はWorkers Buildsを使う。
Queue consumerとDLQはTerraformで接続する。Cronはまだ使わない。

```text
src/
├── application/
│   ├── ports/                 ReplySender、TextGenerator、GenerationQueueなど外部依存の契約
│   ├── health/                ヘルスチェック
│   ├── conversation/          許可判定、ジョブ投入、生成結果の返信
│   ├── memory/                後続の記憶処理
│   ├── reminder/              後続の通知処理
│   └── privacy/               後続の個人情報処理
├── infrastructure/
│   ├── line/                  署名検証とLINE APIへの返信
│   ├── persistence/d1/        生成イベントIDの重複防止
│   ├── ai/                  OpenAI SDK経由のFugu接続
│   ├── privacy/
│   └── queue/
├── presentation/
│   ├── router/                HTTPの受信、入力検証、応答変換
│   ├── queue/               Queueジョブの入力検証
│   └── scheduled/
├── bootstrap/                 環境変数を受け取り、実装を注入
└── index.ts                   Workerエントリーポイント
```

機能のないディレクトリには配置先を示す`.gitkeep`だけを置く。
domain層や専用entityクラスは設けない。
DB導入時はDrizzleのテーブル定義から型を推論し、同じデータ形を手書きで重複定義しない。
型の参照とSQLの実行は分け、SQLはRepositoryへ閉じ込める。

## 依存方向

```mermaid
flowchart LR
  P[presentation] --> A[application]
  I[infrastructure] --> Ports[application/ports]
  B[bootstrap] --> P
  B --> A
  B --> I
```

applicationはLINE APIもWorkersのBindingsも知らず、portsの契約だけを利用する。
署名検証器と返信処理はbootstrapからrouterへ注入する。
依存方向はdependency-cruiserで検査する。

## LINEの処理

1. 生の本文の署名を検証する。
2. ZodでWebhookを検証し、受信形式をapplicationの入力へ変換する。
3. グループではbot宛てのメンション、許可対象、コマンドを確認する。
4. `ping`は即返信。それ以外はQueueへ保存してからWebhookを完了する。
5. consumerで許可グループを再確認し、D1でイベントIDを確保してからFuguを呼ぶ。
6. 短い生成はReply、受信後45秒以降はPushで回答を送る。

通常の発言と、他の人へのメンションには返信しない。
将来の会話保存は、返信判定より前の独立した処理として追加する。
現段階では許可グループのメンション本文だけをFuguへ送る。
本文と回答を記憶として保存しない。QueueとDLQには配送中の本文が一時保持される。

## 判断の記録

採用理由、変更履歴、残る制約は[ADR一覧](adr/README.md)に記録する。
特に[ADR-0005](adr/0005-small-application-boundaries.md)が現在のレイヤー構成を定義する。
