# ADR-0030: 複雑度の悪化防止と依存更新

## Status

Accepted (2026-10-27)

## Context

既存の会話処理に条件分岐が集中している。全関数を一度に書き換えずに複雑度の増加を止めたい。依存関係には監査上の脆弱性がある。

## Decision

- BiomeのnoExcessiveCognitiveComplexityを上限15で測定する。専用設定scripts/quality/biome.jsonを使い、pnpm check:complexityをcheck・check:lint・verifyへ組み込む。
- 導入前の超過24関数だけ、関数単位の現在値をscripts/quality/complexity-baseline.jsonに記録する。新規の超過・既存スコアの増加は失敗させる。ファイル全体の除外や一律の上限緩和はしない。
- 関数の識別はASTの親関数・関数名・コールバック呼び出し名を使用する。同名には出現順を付ける。構造変更で識別子が変わった場合、旧関数との対応を確認し、基準値を手動レビューする。自動で基準値を更新するコマンドは設けない。
- リファクタリングで減ったスコアは基準値も下げる。既存の超過を容認するのは段階移行であり、解消済みとは扱わない。
- pnpmとlockfileを維持し、ランタイム依存・Wrangler・テストツールを修正版へ更新する。Cloudflare型定義は対応版へ更新する。Biome・TypeScript・Agentsの大きな移行は今回の修正に混ぜない。

## Consequences

コード全体のネスト解消は今後も必要。Biomeの通常診断と別に関数単位の判定を行うため、判定スクリプトのテストもverifyに含める。pnpm auditで0件であっても未知の脆弱性やアプリ固有の問題がないことを保証しない。

## Enforcement

新規関数16以上、既存値の増加、UTF-8の日本語を含む診断位置の識別をテストする。pnpm verifyとpnpm auditを依存更新時に実行する。

参考: [Biomeの認知的複雑度ルール](https://v1.biomejs.dev/linter/rules/no-excessive-cognitive-complexity/)。ADR-0002のツール選定を維持する。
