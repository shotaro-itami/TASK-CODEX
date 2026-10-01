---
id: TASK-CODEX-001
status: COMPLETED
spec_version: 2026.09.01-v1
source_fingerprint: sha256:17c2537bddb5bace8c8d2d39ceb6dae97be77f6301b923733277b55fe7915b6d
related_specs: [REQ-037, REQ-038, BAS-036, BAS-037, DET-074, DET-075]
allowed_paths: [.codex/execution-profiles.json, scripts/codex-profile.mjs, tests/codex-profile.test.mjs, package.json, pnpm-lock.yaml, tasks/active/TASK-CODEX-001.md, tasks/completed/TASK-CODEX-001.md, tasks/anchors/TASK-CODEX-001.json]
forbidden_paths: [.codex/config.toml, .codex/agents/**, AGENTS.md, docs/**, src/**, drizzle/**, tools/**, tasks/backlog/**, tasks/proposed/**]
acceptance_criteria: [AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09]
---

# TASK-CODEX-001 — Codex execution profile launcher

## Purpose

Codex CLI向けの抽象execution profileを、modelとreasoning effortへ決定論的に変換する。対応値は単一のrepository-local正本だけに置き、人間がTASKごとにmodel名とreasoning effortを入力しなくてよい起動経路を提供する。

## Scope

- CLI launcherのみを対象とする。
- Desktopのmodel selector自動切替は対象外とする。
- execution profileはmodelとmodel_reasoning_effortだけを選択し、permission profileを変更しない。
- user-level Codex config、project Codex config、依存定義、application機能は変更しない。

## Plan

1. 承認済み4 profileの対応を単一JSONへ定義する。
2. JSON schema/valueとprofile名をfail closedで検証する薄いNode launcherを追加する。
3. shellを介さず、CLI overrideとしてmodelとmodel_reasoning_effortをCodexへ渡す。
4. Codex本体を起動しない単体testで正常系、異常系、権限分離、重複hard-code防止を検証する。
5. task固有testとrepository標準gateを実行し、ACTIVEのままレビュー待ちで停止する。

## Progress

- [x] read-only preflight completed
- [x] base HEAD / clean working tree / active task count inspected
- [x] current Codex CLI version and override precedence rechecked
- [x] baseline `pnpm run spec:check` passed with active_tasks 0
- [x] canonical mapping added
- [x] launcher implemented
- [x] tests implemented
- [x] validation completed

## Decisions

### DEC-001

profileごとのmodel / reasoning effortは `.codex/execution-profiles.json` だけに保持する。launcher、package script、AGENTS.md、TASK本文には対応表を複製しない。

### DEC-002

Codex CLIの公開済み `--model` と `--config model_reasoning_effort=...` を使う。live model catalogの内部JSON形式には依存せず、model availabilityの最終判定はCodex CLI自身に任せる。

### DEC-003

launcherがprofileから注入する設定はmodelとmodel_reasoning_effortに限定する。sandbox、approval、filesystem、network、commit、pushの権限は変更しない。

### DEC-004

Windowsを含む各OSでshell command文字列を組み立てず、Node.jsのprocess起動APIへcommandと引数配列を分離して渡す。追加引数によるmodel / reasoning overrideは拒否する。

## Verification

- baseline `pnpm run spec:check`: success
- acceptance: PASS（9/9、ユーザー確定済み）
- task-specific tests: PASS（22/22、完了処理前の検証結果）
- lint: PASS（warning 1件 / info 25件、自動修正なし）
- typecheck: PASS
- architecture check: PASS
- final `pnpm run spec:check`: PASS（完了処理前のverify内）
- `git diff --check`: PASS（完了処理前の検証結果）
- `pnpm run verify`: PASS（exit 0、Node 180/180、Python 636/636。lint / typecheck / Node / architecture / toolchain / Python / DB / content / specを全完走）
- verify実行前後で確認対象209ファイルの一覧・SHA-256一致、対象5ファイルSHA-256 5/5一致。repositoryへの追加変更なし。

## Remaining

- none（実装・検証・acceptanceは完了。commit・pushは今回の対象外）

## Completion review

2026-09-21、acceptance 9/9および最終verify PASSを確定済みとするユーザーの完了承認に基づき、COMPLETED化する。単一JSONのexecution profile mapping、shellを介さないCLI launcher、fail-closed validationと22件のtask固有testを完了した。

完了処理はTASKの進捗・検証記録・status更新、tasks/completedへの移動、正式コマンドによる新規anchor生成に限定する。このTASK自身のcompleted pathとanchor pathだけをallowed_pathsへ追加し、既存completed / anchorは引き続きallowed_paths外として保護する。実装・テスト・package.jsonの変更、commit、push、次TASK開始は行わない。

## Specification gaps

- none found during preflight

## Acceptance criteria

- [x] AC-01 4 execution profileのmodel / reasoning mappingが一つのファイルだけに存在する
- [x] AC-02 profile名から対応するCLI model / reasoning overrideを構築できる
- [x] AC-03 launcherとpackage.jsonにmappingを重複hard-codeしない
- [x] AC-04 invalid profile / invalid mappingではCodexを起動せず失敗する
- [x] AC-05 execution profileがpermission関連設定を変更しない
- [x] AC-06 user-level Codex configを変更しない
- [x] AC-07 Windowsでlauncherの基本動作を確認できる
- [x] AC-08 task tests、既存check、spec:checkが成功する
- [x] AC-09 working treeの変更がallowed scope内だけである
