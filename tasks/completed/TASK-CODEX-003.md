---
id: TASK-CODEX-003
status: COMPLETED
execution_profile: deep
spec_version: 2026.09.01-v1
source_fingerprint: sha256:17c2537bddb5bace8c8d2d39ceb6dae97be77f6301b923733277b55fe7915b6d
related_specs: [REQ-037, REQ-038, REQ-039, BAS-036, BAS-037, DET-074, DET-075, DET-076, DET-086]
allowed_paths: [tasks/active/TASK-CODEX-003.md, tasks/completed/TASK-CODEX-003.md, tasks/anchors/TASK-CODEX-003.json, scripts/spec/lib.mjs, scripts/spec/governance.mjs, scripts/spec/check.mjs, scripts/codex-task.mjs, tests/codex-task.test.mjs, tests/spec/sync-governance.test.mjs, tests/spec/task-scope.test.mjs, docs/codex-task.md, var/content-pipeline/task-codex-003/**]
forbidden_paths: [.codex/**, .agents/**, .git/**, .gitignore, AGENTS.md, README.md, package.json, pnpm-lock.yaml, scripts/codex-profile.mjs, tests/codex-profile.test.mjs, docs/product-specs/**, docs/spec-manifest.yaml, docs/traceability.yaml, src/**, drizzle/**, tools/**, tasks/backlog/**, tasks/proposed/**]
acceptance_criteria: [AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12]
---

# TASK-CODEX-003 — TASK単位の機械的scope guard

## Purpose

TASKの `allowed_paths` / `forbidden_paths` を唯一のscope定義として、Gitで観測できるrepository変更をCodex起動前と終了後に検査する。許可と禁止が競合する場合は必ず禁止側を優先する。

## Background / related specifications

TASK-CODEX-002が確立したTASK → execution profileの起動経路とfrontmatter拒否仕様を維持し、既存のTASK governanceを再利用する。

- REQ-037 / BAS-036 / DET-074: 承認済み仕様・TASKを正本として参照し、仕様を独自に拡張しない。
- REQ-038 / BAS-037 / DET-075: ACTIVE TASKを原則1件とし、変更範囲と完了履歴を分離する。
- DET-076: scope外変更、仕様不明・矛盾は停止する。
- REQ-039: 正式完了前のFULL VERIFYを維持する。
- DET-086: spec_version / source_fingerprintと同期生成物の整合を維持する。

開始時基準（2026-09-23）: branch `main`、HEAD `0a4768aab2c4c3f105e72779fbfb8780424fe9bf`、working tree clean、TASK-CODEX-002はCOMPLETED、active / completed / anchorは0 / 20 / 20。現在のGit・TASK状態で一致を確認した。直近FULL VERIFY PASS、Node 211/211、Python 636/636はTASK-CODEX-002の完了記録で確認した履歴であり、今回の再実行結果ではない。

## Execution profile

`execution_profile: deep` を使用する。実装開始が別途承認された後のCLI起動は、repo rootの既存 `pnpm run codex:task TASK-CODEX-003` 経路を使用する。profile mappingとlauncher設定を変更しない。今回のTASK作成時にはCodex子プロセスを起動しない。

## Scope / allowed areas

- 共通parser・path判定・Git差分取得・spec検査は `scripts/spec/lib.mjs`、`scripts/spec/governance.mjs`、`scripts/spec/check.mjs` を再利用する。
- `scripts/codex-task.mjs` に既存profile連携を維持した起動前・終了後検査を組み込む。
- 回帰テストはfrontmatter記載の3 testファイル、運用説明は `docs/codex-task.md` に限定する。
- scope設定の別ファイル、別matcher、glob dependency、Git hook、profile mappingを追加しない。
- frontmatterの2配列だけをscope定義とする。未許可pathは拒否し、forbiddenに一致すればallowedに一致しても拒否する。
- 自TASKのactive本文、正式完了先、専用の新規anchorだけを許可する。他TASK・既存completed・既存anchorはallowed_paths外として拒否する。completed/anchors全体の禁止patternを追加して自TASKの完了先と衝突させない。
- `var/content-pipeline/task-codex-003/**` は本TASK専用の検証用一時データ・log置場に限る。

### 今回の実行段階

2026-09-27の継続指示により、既存差分9件（本TASK、docs/codex-task.md、scripts/codex-task.mjs、scripts/spec/check.mjs、scripts/spec/governance.mjs、scripts/spec/lib.mjs、tests/codex-task.test.mjs、tests/spec/sync-governance.test.mjs、tests/spec/task-scope.test.mjs）のレビュー・必要最小修正・検証を実施する。既存matcherの意味論とflat parserの互換性を維持することが正式決定された。TASKはACTIVEを維持し、commit / push / completed移動 / anchor生成は実施しない。以下の作成時の基準・検証記録は履歴として保持する。

## Guarantee boundary

機械的scope guardの保証対象は、Gitで観測可能な次のrepository変更とする。

- tracked、staged、unstaged、ordinary untrackedの変更。
- 新規、削除、renameの旧pathと新path。stage状態によらず両端を検査する。
- Codex実行中のcommitによってstatusから消えた変更。起動時HEADから終了時HEADまでの差分を追加して補足する。

Git ignored filesystem changesそのものは保証対象外。`var/content-pipeline/task-codex-003/**` の許可は専用一時領域の利用許可であり、ignored領域全体の監視を意味しない。

ignored領域を含む完全なfilesystem監視、書込み直前のOSレベル遮断、一時的に変更後復元された操作の完全検出はNon-scopeとする。起動前・終了後のGit観測による検査の保証範囲を超えて完全な書込み防止を主張しない。

## Implementation approach

1. 既存parser / matcherを再利用し、allowed_pathsが必須の非空配列であることとforbidden_pathsの妥当性を検証する。
2. 既存matcherをsingle source of truthとして再利用し、exact / `*` / `**`、case-sensitive、`allowed/**` とdirectory自身の不一致、platformごとのseparator処理を維持する。既存TASKの実例をcharacterization testで比較する。flat parserの既存値解釈（`[23]` は文字列配列、trimと空要素除去）も維持する。traversal、絶対path、separator差を用いた迂回、repo外へのpath解決はpath検査で拒否する。別matcherや依存を追加せず、既存文法を独自に拡張・縮小しない。
3. 起動前にTASK scopeのsnapshotとHEADを確定する。Git statusの新規・削除・rename両端を検査し、違反時は非0終了、Codex spawn 0とする。
4. Codex終了後は起動時に確定したscopeを使用する。TASK本文の変更・移動で終了時scopeを拡張しない。
5. 終了時statusと起動時HEADから終了時HEADまでの差分を検査する。scope違反があればCodex本体が0終了でも成功扱いにしない。
6. 自TASKの正式完了移動と専用新規anchorを許可し、他TASK・既存anchorの保護と既存frontmatter/profile連携を維持する。
7. Git / metadata / path検査失敗は明確な診断と非0終了にする。error code、対象、期待値、実値、参照先を確認可能にする。

## Non-scope / prohibited changes

- package / dependency / lockfile変更。
- execution profile mapping変更、`scripts/codex-profile.mjs` と `tests/codex-profile.test.mjs` の変更。
- OS権限、ACL、owner、sandbox、approval設定の変更。
- Git hook、filesystem watcher、新しいscope設定ファイル、別matcher、glob dependencyの追加。
- 製品コード、DB、教材pipeline、承認済み仕様・同期生成物の変更。
- 既存completed TASK・既存anchorの変更、他TASKへの変更。
- ignored領域を含む完全なfilesystem監視、書込み直前のOSレベル遮断、一時的に変更後復元された操作の完全検出。
- commit、push、TASK-CODEX-004以降への着手。

## Acceptance criteria

- [x] AC-01: allowed_pathsを必須の非空配列として検証する。
- [x] AC-02: forbidden_pathsを検証し、allow/forbid競合時は必ず禁止側を優先する。
- [x] AC-03: 既存scope matcher / flat parserとの後方互換性を維持し、characterization testで確認する。matcherとrepository内へのpath検査を分離し、独自文法を追加しない。
- [x] AC-04: traversal、絶対path、separator差、repo外path解決を拒否する。
- [x] AC-05: 新規、削除、rename両端をstage状態によらず検査する。
- [x] AC-06: Codex起動前のscope違反は非0終了とし、Codex spawn回数を0にする。
- [x] AC-07: Codex終了後は起動時に確定したscopeを使用し、違反があればCodex本体が0終了でも成功扱いにしない。
- [x] AC-08: Codex実行中のcommitによるstatus差分消失を検査漏れにしない。
- [x] AC-09: TASK-CODEX-003自身の正式完了処理は許可し、他TASK・既存anchorへの変更を拒否する。
- [x] AC-10: TASK→execution profile連携、既存frontmatter拒否仕様、completed TASK / anchor履歴を維持する。
- [x] AC-11: Git / metadata / path検査失敗を明確な診断付きで非0終了させる。
- [x] AC-12: 必須回帰テストとFULL VERIFYをPASSさせる。

TASK作成・ACTIVE化のみでこれらの実装acceptanceをPASSにしない。

## Required tests / validation commands

cwd: `C:\アプリ\勉強アプリ\study-app`。

今回の確認: 開始前の `pnpm run spec:check`、作成後のユーザー指定 `pnpm run spec`、既存正式gateの `pnpm run spec:check`、TASK構造・frontmatter・scope整合、`git diff --check`、新規TASKのwhitespace確認、`git status`、TASK / anchor件数を確認する。`spec` scriptは開始時のpackage.jsonに存在しないため、指定commandの結果とspec:checkの結果を区別し、package scriptを追加しない。

実装フェーズの必須回帰:

- 非空allowed配列、forbidden配列、競合優先順位、既存matcher / flat parserとのcharacterization、traversal / 絶対path / separator / repo外解決。
- 新規・削除・rename旧新pathとstaged / unstaged / ordinary untrackedの組合せ。
- 起動前拒否時の非0終了 / spawn 0、正常な許可path時の成功と起動成立。
- 起動後のscope書換え・自TASK移動、Codex成功後の違反、起動中commitでstatusから消えた変更。
- 自TASKの正式完了pathと専用anchorの許可、他TASK・既存anchorの拒否。
- TASK→profile、既存frontmatterの正常終端と不正終端の拒否、Git / metadata / path検査失敗。

実装後のcommand:

1. `node --test tests/spec/task-scope.test.mjs tests/spec/sync-governance.test.mjs tests/codex-task.test.mjs`。
2. `node --test tests/codex-profile.test.mjs`（既存テストを変更せず回帰確認）。
3. `pnpm run lint`（read-only、自動修正なし）。
4. `pnpm run typecheck`。
5. `pnpm test`。
6. `pnpm run architecture:check`。
7. `pnpm run spec:check`、`git diff --check`、untrackedも含む変更範囲確認。
8. 正式完了前の `pnpm run verify`（FULL VERIFY）。

commit検出のテストは隔離した検証用Git fixtureで行い、本repositoryでcommitしない。Node依存はpnpm、Python pipelineはuvを維持し、検証のため依存・権限・設定を変更しない。

## Plan

1. 現在状態と開始前gateを確認する。
2. 本TASKを正式作成し、ACTIVE / deep / 保証境界 / scope / ACを記録する。
3. 作成後gate・構造・変更範囲・件数を確認し、結果を報告して停止する。
4. 別途実装開始の指示を受けた後、既存機構を再利用して実装・回帰検証する。
5. FULL VERIFYとACレビュー後、正式完了の指示に従って自TASKのみ完了処理する。

## Progress

- [x] 基準状態と既存仕様の確認。
- [x] 開始前 `pnpm run spec:check` PASS。
- [x] TASKの正式作成・ACTIVE化・保証境界の記録。
- [x] 作成後gateの実行と最終差分確認（指定spec commandのFAILを記録）。
- [x] scope guard実装（2026-09-27、既存matcher / parser互換性を維持）。
- [x] 回帰テスト・FULL VERIFY・ACレビュー。
- [x] 正式完了処理（2026-09-28）。

## Decisions

- TASKの2配列を唯一のscope定義とし、forbiddenを優先する。共通実装と既存起動経路を再利用する。
- ignored file境界に関するSPEC_GAPはユーザーの明示決定により解決済み。保証対象は本TASKのGuarantee boundaryのとおり。
- 作成時はTASK作成・ACTIVE化・開始前gateまでに限定した。2026-09-27の継続指示で既存9件の最小修正・検証を承認。mapping、設定、completed、anchorは変更しない。
- REQ-037 / DET-076に基づき、既存matcher / parserの後方互換性を維持する。前回のscope文法SPEC_GAPはこの正式決定によりRESOLVED。同期生成仕様は変更しない。

## Stop conditions / Specification gaps

- ignored file境界: **RESOLVED**。Git ignored filesystem changesは保証対象外、専用一時領域は検証用途として許可する。
- 今回確認したbranch / HEADまたは承認された9件以外の未知差分、仕様とTASKの矛盾、frontmatter / scopeの独自拡張が必要な場合は変更せず停止する。
- 今回、承認された9件以外の変更が必要になった場合は変更前に必要性を確認する。互換性維持がscopeを大きく超える変更、既存TASKの大量修正、TASK-CODEX-001 / 002の仕様変更を必要とする場合、または無関係な既存差分を発見した場合はBLOCKEDで停止する。
- 実装時もallowed_paths外の変更、既存履歴の改変、新依存、権限変更が必要なら停止する。
- 新たな仕様不足・矛盾はSPEC_GAPとして対象仕様ID、影響箇所、必要判断、停止工程を記録する。検査失敗を自動修復やscope拡張で回避しない。

## Verification

### 作成時の履歴

- 作成前 `pnpm run spec:check`: PASS、SPEC_CHECK_OK、active_tasks 0。
- 開始時branch / HEAD / clean / 0・20・20 / TASK-CODEX-002 COMPLETED: 基準と一致。
- 作成後 `pnpm run spec`: FAIL、exit 1、`ERR_PNPM_NO_SCRIPT` / `Missing script: spec`。期待は指定scriptの実行、実値はpackage.jsonにscript未定義。package変更は禁止のため追加しない。既存正式gateと結果を混同しない。
- 作成後 `pnpm run spec:check`: PASS、SPEC_CHECK_OK、active_tasks 1。現在の仕様fingerprintと既存completed / anchorを検証。
- TASK構造・frontmatter・scope照合: PASS。ACTIVE / deep / AC 12件 / metadata key重複なし / allowed非空配列 / forbidden配列を確認。全allowed pathはforbiddenと非競合。自TASKの完了先は許可、他TASK・既存completed 20件・既存anchor 20件は拒否。既存matcherの禁止優先も確認。scope guard本体の実装検証ではない。
- `git diff --check` と新規TASKの `git diff --no-index --check`: PASS。LF→CRLFのGit通知のみ。
- active / completed / anchor: 1 / 20 / 20。branchとHEADは開始時と同一。
- changed files: `tasks/active/TASK-CODEX-003.md` のみ（untracked）。tracked / staged差分なし。scope guard実装・commit・pushは未実施。
- FULL VERIFYは今回未実行。実装acceptanceは未検証。

### 2026-09-27 継続実装・検証

既存9件をレビューし、以下の判断で採用した。全ファイルの一括破棄は行っていない。不要部分として、既存globの拒否、case-insensitive化、directory自身への一致拡大、数値風文字列の型推測、parserの空要素処理変更とそれを固定した期待値を除外した。

| ファイル | 判断と根拠 |
| --- | --- |
| docs/codex-task.md | 修正して採用。既存文法、parser解釈、scope guardの保証境界を記載。 |
| scripts/codex-task.mjs | 修正して採用。起動時snapshot・前後検査を維持し、globのliteral prefixだけをpathとして解決。 |
| scripts/spec/check.mjs | そのまま採用。ACTIVE / completionの検査を共通governanceへ統合。 |
| scripts/spec/governance.mjs | 修正して採用。HEAD版matcher本体を維持し、metadata / repository内path / Git検査を追加。 |
| scripts/spec/lib.mjs | 修正して採用。TASK-CODEX-002の重複key・flat構造・終端拒否を共通化し、既存値parserを維持。 |
| tests/codex-task.test.mjs | 修正して採用。文法互換性・前後違反の実プロセス終了値とspawn回数を検証。 |
| tests/spec/sync-governance.test.mjs | 修正して採用。既存特殊pathテストを保持し、spec gateの共通glob判定を確認。 |
| tasks/active/TASK-CODEX-003.md | 修正して採用。今回の承認、互換性決定、AC-03、検証結果を記録。status / profile / scope配列は維持。 |
| tests/spec/task-scope.test.mjs | 修正して採用。旧matcherとのcharacterization、Git状態、path解決、完了履歴を検証。 |

検証結果:

- matcherのescapeRegex / pathMatchesPattern本体は開始HEAD版とソース一致。
- characterization 30件PASS。exact、*、**、case、directory自身・配下、separator、repo root基準を確認。既存ACTIVE / COMPLETED 21 TASKのscope表現532件も旧matcher oracleと比較。履歴は検証入力に限り使用し、変更権限として流用していない。
- flat parser: [23]、数値・真偽値風文字列、空要素、引用符・括弧のliteral解釈を維持。既存TASK-CODEX-002の不正終端・重複key拒否は継続。
- 対象3 test + codex-profile + task-anchors + historical-task-fingerprint: 176/176 PASS、skip 0。実行command: node --test tests/spec/task-scope.test.mjs tests/spec/sync-governance.test.mjs tests/codex-task.test.mjs tests/codex-profile.test.mjs tests/spec/task-anchors.test.mjs tests/spec/historical-task-fingerprint.test.mjs。
- 追加テストのstaged新規・削除fixtureは同一内容によりGitがrename認識し初回FAIL。指定どおり3回再実行で再現を確認し、新規fileを異なる内容へ修正した。期待値を維持して対象2/2、その後176/176 PASS。
- 実プロセス: 正常exit 0 / spawn 1、preflight違反exit 1 / spawn 0、postflight違反exit 1 / spawn 1。
- pnpm run lint: PASS、read-only、warning 1 / info 25。pnpm run typecheck、pnpm run architecture:check: PASS。
- pnpm test: 301/301 PASS、skip 0。
- pnpm run verify: PASS、exit 0。Node 301/301、Python 636/636、architecture / toolchain / DB / content / specもPASS。
- pnpm run spec:check: 開始時PASS、FULL VERIFY内SPEC_CHECK_OK。検証記録後の再実行もPASS、SPEC_CHECK_OK。
- git diff --check: whitespace指摘なし。untrackedのTASK・testもno-index --checkでwhitespace指摘なし。検証記録後の最終再確認もPASS（tracked exit 0、untrackedは差分ありのexit 1、whitespace診断0）。
- 実TASKのscope: 自active / completed / 専用anchorは許可、既存completed 20件とanchor 20件は拒否。履歴hash保護の回帰PASS。

| AC | 判定 | 根拠 |
| --- | --- | --- |
| AC-01 | PASS | 非空allowed配列、欠落・scalar・不正型の拒否。 |
| AC-02 | PASS | forbidden配列と競合時の禁止優先。 |
| AC-03 | PASS | 旧matcher / parserとのcharacterization、実TASK表現比較、matcherソース一致。 |
| AC-04 | PASS | traversal・absolute・drive / UNC・separator迂回・外部junction / symlink拒否、内部aliasの禁止判定。 |
| AC-05 | PASS | staged / unstaged / ordinary untracked、新規・削除・rename両端、mixed状態。 |
| AC-06 | PASS | 実プロセスのpreflight違反exit 1 / spawn 0、正常exit 0 / spawn 1。 |
| AC-07 | PASS | scope書換え・TASK移動後も起動時snapshotを使用。child 0後の違反を拒否。 |
| AC-08 | PASS | 隔離fixtureでcommit後statusが空でもHEAD間差分を検査。 |
| AC-09 | PASS | 自TASK完了先 / anchorの許可、他TASK・既存anchorの拒否と履歴保護。 |
| AC-10 | PASS | TASK-CODEX-001 / 002、4 profile、protected override、frontmatter終端・重複key、履歴回帰。 |
| AC-11 | PASS | Git取得・HEAD / status / diff不正、metadata / path失敗の診断と非0終了。 |
| AC-12 | PASS | 必須回帰176/176、通常Node 301/301、FULL VERIFY全ゲートPASS。 |

branch / HEAD: main / 0a4768aab2c4c3f105e72779fbfb8780424fe9bf。working treeは承認済み9件（tracked変更7、untracked 2）、stagedなし。active / completed / anchorは1 / 20 / 20。scope外変更・無関係変更なし。同期生成仕様、既存TASK履歴、profile mappingを変更していない。TASKはACTIVEを維持し、commit / push / completed移動 / anchor生成は本repositoryでは実施していない。fixture内のcommit / anchorは検証用途のみ。

## Completion conditions / Remaining

- none（実装・検証・acceptance・完了レビューは完了。commit・pushは今回の対象外）

## Completion review

- 完了日: 2026-09-28
- status: COMPLETED
- Acceptance: AC-01〜AC-12すべてPASS（12/12）
- COMPLETION REVIEW: PASS

ユーザーの正式完了承認に基づき、TASK-CODEX-003自身だけをcompleted化し、正式コマンド `node scripts/spec/task-anchors.mjs --write tasks/completed/TASK-CODEX-003.md` で `tasks/anchors/TASK-CODEX-003.json` を新規生成する。

完了処理の変更範囲は本TASKのmetadata・進捗・完了記録・移動と新規anchorだけ。既存anchorは変更せず、GPT-6 profile modernization、TASK-CODEX-004、`.codex/execution-profiles.json` は対象外として保持する。実装済み9件のレビュー済み差分は保持し、commit / pushは行わない。

### Final verification

正式完了処理後の最終commit候補状態に対して、`pnpm run spec`、`git diff --check`、TASK / anchor整合性、active / completed / anchor件数、scope guard関連回帰、`pnpm run verify` を確認する。FULL VERIFYを含む必須検証がすべてPASSした場合のみ正式完了処理PASSと判定する。`pnpm run spec` は開始時からpackage script未定義であるため、既存正式spec gateの `pnpm run spec:check` と結果を区別して記録する。
