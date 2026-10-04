# ADR-0013: 層に依存しない共通定義をcoreへ置く

## Status

Accepted (2026-10-04)

## Context

FailureCodeなどの共通型をapplicationに置くと、将来domainから使う際に依存方向が逆転する。

## Decision

- FailureCodeとConfigurationIssueを`src/core/diagnostics.ts`へ置き、利用箇所から直接参照する。
- coreは他の層や外部パッケージに依存しない。
- applicationはapplication、domain、coreを参照できる。将来のdomainはdomainとcoreだけを参照できる。
- ログ出力を依頼するDiagnosticsはapplicationのポートとして残す。
- 機能固有のデータ型やポートは、複数箇所から使うという理由だけでcoreへ移さない。

## Consequences

domainを今すぐ作る必要はなく、後で共通型だけを参照できる。
coreを汎用的な処理の無制限な置き場にせず、層への依存がない定義に限定する。

## Enforcement

dependency-cruiserでcoreとdomainの依存先を制限する。
`tsconfig.core.json`はcore、domain、applicationを外部ランタイムの型なしで検査する。
