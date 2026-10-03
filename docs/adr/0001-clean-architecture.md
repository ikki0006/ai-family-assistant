# ADR-0001: 単一アプリのクリーンアーキテクチャ

## Status

Superseded by [ADR-0005](0005-small-application-boundaries.md) (2026-10-04)

## Context

家族向けLINEアシスタントは、会話、記憶、通知を扱う。
LINE、Cloudflare、AIプロバイダーの変更が業務ルールに波及しない構造を必要とする。
現時点では単一アプリのため、モノレポやDIコンテナーを導入する理由はない。

## Decision

- `domain`は業務上の型、状態、判定ルールを持つ。DB、HTTP、SDK、環境変数に依存しない。
- `application`はユースケースと外部依存の契約である`ports`を持つ。domainとapplicationだけを参照する。
- `infrastructure`はportsの具体的な実装を持つ。外部APIの再試行やDBの型変換もここで行う。
- `presentation/router`はHonoのHTTP入口と入出力変換を持つ。`http`というディレクトリ名は使わない。
- `presentation/queue`と`presentation/scheduled`は、それぞれ非同期処理と定期処理の入口を持つ。
- `bootstrap`で設定を読み、具体的な実装を生成して引数で注入する。
- `src/index.ts`はWorkersのエントリーポイントとする。
- 原則は名前付きexportとし、Workerの入口とツール設定だけdefault exportを許容する。

`domain/memory`と`application/memory`は、同じ記憶を異なる責務で扱う。
前者は記憶の状態と有効性を定義し、後者は保存や取得を含む処理を組み立てる。
同じ機能名のディレクトリがあっても、同じモデルや判定を複製しない。

例えば記憶の参照では、domainが「有効期限を過ぎた記憶を使わない」という判定を担当する。
applicationはRepositoryから候補を取得し、domainの判定を適用して結果を返す。
D1のSELECT文と行からdomainの型への変換はinfrastructureが担当する。

## Consequences

ユースケースを外部サービスなしでテストできる。
インターフェースと変換コードが増えるため、未実装の機能について仮のメソッドや大きな汎用Repositoryを先に作らない。
機能用ディレクトリは配置先だけ用意し、実装が必要になった時点でファイルを追加する。

## Enforcement

`pnpm check:architecture`で逆向きのimport、循環参照、未解決のimportを検出する。
型だけのimportも検査対象とする。
`pnpm typecheck`はcoreをCloudflareやNodeのグローバル型なしでも検査する。
業務ルールをどの層に置くかは、[architecture.md](../architecture.md)の具体例に照らしてレビューする。
