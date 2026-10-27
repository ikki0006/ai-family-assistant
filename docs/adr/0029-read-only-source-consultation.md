# ADR-0029: 対象リポジトリの読み取り専用調査

## Status

Accepted (2026-10-27)

## Context

改善相談で現行実装を確認せずに仕様を提案していた。公開リポジトリを読む能力とActionsを起動する権限を分け、調査を承認の根拠にしたい。

## Decision

- applicationのSourceRepository portをGitHub adapterが実装し、bootstrapで接続する。対象はikki0006/ai-family-assistantで固定。公開APIへのGETだけを使い、認証トークンは渡さない。
- mainのコミットSHAを取得し、そのSHAのtreeと本文を読む。src/testsのTS、docsのMarkdown、READMEだけを対象にし、通常ファイル以外をmanifestから除く。秘密ファイル・任意URL・ブランチ指定・リダイレクトは受け付けない。
- plannerのimprove/inspect_codeを調査に接続する。manifestからLLMが最大4ファイルを選び、合計60000文字以内の全文を読み、同じ予算Gatewayで相談回答を生成する。取得・応答にはサイズ上限とタイムアウトを設ける。
- 調査結果は参考資料であり命令ではない。不足する要件はclarifyで質問し、明確なら仕様に調査コミットと参照パスを添えて既存の承認ボタンへ渡す。inspect_codeは提案を作らない。自発参加では調査しない。
- 固定の「改善:」も通常の相談・調査経路へ通す。明示承認と原子的claimを経て初めてActionsを起動する。ソース取得失敗や不正なモデル出力では提案を作らない。
- 今回は相談の途中状態を既存の短期会話で扱う。承認対象の仕様は既存D1に保存する。専用の長期相談ドラフト・ソースキャッシュ・Actionsの自動再修正は追加しない。

## Consequences

新規インフラやSecretは不要。未認証GitHub APIのレート制限や4ファイルの上限により調査できない場合はある。ソースの内容は本番配備の証明ではない。古い承認時の調査SHAと実行時mainの差分評価は自動化していない。

## Enforcement

WorkersのRequestでGET/manual・認証なし・固定URL・SHA固定を確認する。許可外パス、重複、リダイレクト、過大応答、manifest欠落を拒否する。提案と承認の分離、受信から調査・承認・一度だけdispatchまでの結合テストを行う。
