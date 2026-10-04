# ADR-0005: 処理手順と外部接続を分離する

## Status

Accepted (2026-10-04)

## Context

現時点の中心はLLMへの依頼とDBへの保存であり、独立した複雑な業務モデルはまだない。
domainとapplicationの両方にmemoryを設けると、実際の責務がない層を維持することになる。
ユーザーとの検討で、DB導入時はDrizzleの推論型を使う方針になった。

## Decision

- ADR-0001を置き換え、domain層と専用entityクラスを設けない。
- applicationは処理手順とports、infrastructureは外部接続、presentationはrouter等の入口を持つ。
- bootstrapで実装を組み立てる。applicationからinfrastructureの実装をimportしない。
- 現在はDBがないため、Drizzleのテーブルやモデルは追加しない。
- DB導入時は独立した`src/schema`にテーブル定義と推論型を置く。applicationからは`import type`で参照し、SQL実行はRepository内に閉じ込める。
- schema導入時に、その型参照だけを許す依存検査ルールを追加する。共通型の参照はADR-0013に従う。
- 型共有によるDB構造への依存を受け入れ、同じデータ形の手書きentity型を重複させない。
- `presentation/router`という命名、名前付きexport、引数による依存注入は維持する。

## Consequences

独立した業務ルールが育つまではapplication内の関数で表現できる。
将来ドメインモデルが必要になった場合は、該当箇所だけを切り出す。
Drizzleの推論型は静的な型であり、実行時の入力検証を代替しない。

## Enforcement

`pnpm check:architecture`で逆方向の依存と循環を検出する。
`pnpm typecheck`はapplicationを外部ランタイムのグローバル型なしでも検査する。
