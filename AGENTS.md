# Codex開発案内

## 読む順番

1. `AGENTS.md`
2. `docs/product-specs/index.md`
3. `tasks/active/` のactive task
4. active taskの `related_specs`
5. 関連コード
6. 関連テスト

無関係な仕様とcompleted taskは、必要になるまで読まない。

## 禁止事項

- 仕様にない挙動・DB項目・状態・外部依存を推測して追加しない。
- 仕様不明時は `SPEC_GAP` を記録して停止する。
- taskと仕様が矛盾した場合は停止する。
- taskの `allowed_paths` 外を変更しない。
- 不要なrefactorや「ついで修正」をしない。
- 次のtaskを勝手に実装しない。
- proposed taskを承認なしに実装・active化しない。
- Google Sheet由来の承認仕様や同期生成物をCodex判断で変更しない。

## 検証

仕様同期後とtask開始前に `pnpm run spec:check` を実行する。
コード変更後は `pnpm run lint`、`pnpm run typecheck`、`pnpm test`、`pnpm run architecture:check` を実行し、task完了前に `pnpm run verify` を実行する。lintはread-onlyで実行し、自動修正を使わない。
失敗時はerror code、対象、期待値、実値、参照先を確認し、仕様判断が必要なら `SPEC_GAP` とする。

詳細は [仕様索引](docs/product-specs/index.md) とactive taskを参照する。

TASKに記録したexecution profileでCLIを起動する場合は、repo rootで `pnpm run codex:task <TASK-ID>` を使う。metadataと起動・拒否条件は [TASK起動手順](docs/codex-task.md) を参照する。

repository maintenance時は `pnpm run maintain` をread-onlyで使う。通常TASKの完了条件は引き続きverifyであり、maintainは別ゲートとする。findingは人間確認用の別TASK候補として記録し、その場で修正・起票・active化しない。詳細は [保守ゲート](scripts/maintenance/README.md) を参照する。

Python教材パイプラインは `tools/content-pipeline` の独立uv projectで管理する。Node.js依存はpnpm、Python依存はuvを使い、相互に管理しない。
