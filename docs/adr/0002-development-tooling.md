# ADR-0002: 開発ツールと品質チェック

## Status

Accepted (2026-10-04, amended 2026-10-04)

## Context

既存の`recruta-ai-interview`に合わせたコード整形と、ローカルで実行できる品質チェックが必要である。
このリポジトリはCloudflare Workers向けの単一TypeScriptアプリとして構築する。

## Decision

- パッケージ管理はpnpmとし、packageManagerでバージョンを固定する。
- BiomeでLint、整形、import整理を行う。参照先に合わせてBiome 1.9.4、タブ幅2、行幅100を採用する。
- `pnpm check`は読み取り専用とし、警告も失敗として扱う。自動修正は`pnpm fix`、整形だけなら`pnpm format`を使う。
- ESLintとPrettierを重複導入しない。Terraformの整形は`terraform fmt`で行う。
- Wranglerでローカル開発とビルドを行う。Viteの開発サーバーは使用しない。
- Vitestを単体テストに、Cloudflare公式VitestプラグインをWorkers上の結合テストに使う。
- dependency-cruiserでADR-0005の依存方向を検査する。
- Lefthookのpre-commitで`pnpm check`、pre-pushで`pnpm verify`を実行する。フック導入は`pnpm hooks:install`で明示的に行う。
- VS Codeの保存時整形はBiomeを使う。
- ランタイム依存は使う段階で追加する。ZodはWebhookの入力検証に使用し、DrizzleはDB導入時に追加する。

## Consequences

参照先の書式を保ちつつ、チェックの実行による意図しない書き換えを避けられる。
Biome 2への更新は、ルールと設定の移行を検証してから行う。
Biomeの対象外となるMarkdownとYAMLの書式はEditorConfigとレビューで扱い、これらも整形済みだとは主張しない。

依存パッケージの取得にはネットワークが必要な場合がある。
初回インストールが完了したら、生成された`pnpm-lock.yaml`をコミットし、以後は`pnpm install --frozen-lockfile`を使う。
取得できていない依存関係について、架空のlockfileを作らない。

## Enforcement

`pnpm verify`でLint、依存方向、ADR形式、型、テスト、ビルド、Terraform書式を検査する。
依存解決とlockfileの生成が済むまでは、全検証が完了した状態として扱わない。

Vite導入を再検討した結果、現在のバックエンド専用アプリにはWranglerで十分と判断した。
Vitestの内部依存としてViteが存在することは、アプリの開発サーバーとしてViteを使うこととは区別する。

参考: [WranglerとViteの比較](https://developers.cloudflare.com/workers/local-development/wrangler-vs-vite/)、[Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)。
