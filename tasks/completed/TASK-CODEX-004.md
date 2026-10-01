---
id: TASK-CODEX-004
status: COMPLETED
execution_profile: deep
spec_version: 2026.09.01-v1
source_fingerprint: sha256:17c2537bddb5bace8c8d2d39ceb6dae97be77f6301b923733277b55fe7915b6d
related_specs: [REQ-037, REQ-038, REQ-039, BAS-036, BAS-037, DET-074, DET-075, DET-076, DET-086]
allowed_paths: [tasks/active/TASK-CODEX-004.md, tasks/completed/TASK-CODEX-004.md, tasks/anchors/TASK-CODEX-004.json, .codex/execution-profiles.json, scripts/codex-profile.mjs, scripts/codex-task.mjs, tests/codex-profile.test.mjs, tests/codex-task.test.mjs, docs/codex-task.md, var/content-pipeline/task-codex-004/**]
forbidden_paths: [.agents/**, .git/**, .gitignore, AGENTS.md, README.md, package.json, pnpm-lock.yaml, scripts/spec/**, docs/product-specs/**, docs/spec-manifest.yaml, docs/traceability.yaml, src/**, drizzle/**, tools/**, tasks/backlog/**, tasks/proposed/**, tasks/completed/TASK-CODEX-001.md, tasks/completed/TASK-CODEX-002.md, tasks/completed/TASK-CODEX-003.md, tasks/anchors/TASK-CODEX-001.json, tasks/anchors/TASK-CODEX-002.json, tasks/anchors/TASK-CODEX-003.json]
acceptance_criteria: [AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10]
---

# TASK-CODEX-004 — Modernize execution profiles

## Background

TASK-CODEX-001 introduced the repository-local execution profile mapping and launcher boundary. TASK-CODEX-002 connected ACTIVE TASK metadata to that mapping through `pnpm run codex:task <TASK-ID>`. TASK-CODEX-003 added mechanical TASK scope guard checks around the launcher path.

This means the profile definitions can now be modernized through a narrow, observable TASK instead of changing operational settings ad hoc. UI notices about older model retirement and newer model availability are useful signals, but UI state alone does not prove that Codex CLI accepted and applied a profile in a real session.

Start baseline at TASK creation time: branch `main`, HEAD `9b39e6756e7a3a5d8c627f3137f9e4819ea2db66`, working tree clean, active / completed / anchor counts `0 / 21 / 21`, and `pnpm run spec:check` PASS with `active_tasks: 0`.

## Purpose

Update the four repository execution profiles to candidate newer model-generation values and prove that the definitions, launcher integration, TASK integration, real session application evidence, and spec gate all hold together.

Candidate profile targets:

| Profile | Candidate model | Candidate reasoning effort |
| --- | --- | --- |
| `light` | `gpt-6-luna` | `low` |
| `standard` | `gpt-6-sol` | `medium` |
| `deep` | `gpt-6-sol` | `high` |
| `review` | `gpt-6-astra` | `xhigh` |

These model names are TASK candidates to verify. If Codex CLI rejects any candidate model or reasoning effort, stop as BLOCKED and do not substitute a different mapping without a new user decision.

## Scope

- Change `.codex/execution-profiles.json` only as needed to represent the four candidate profile mappings.
- Adjust profile loading, validation, launcher integration, TASK launcher integration, tests, and `docs/codex-task.md` only where required to keep the existing profile contract correct.
- Use the existing TASK launcher path, `pnpm run codex:task TASK-CODEX-004`, to verify TASK-to-profile behavior.
- Capture real session JSONL evidence proving that the effective `model` and reasoning `effort` match the expected value for each profile, or record the exact blocker when CLI acceptance fails.
- Keep all changes inside this TASK's `allowed_paths` and preserve TASK-CODEX-003 scope guard behavior.

## Non-scope / prohibited changes

- 勉強アプリ本体の機能実装。
- unrelated refactor or formatting churn.
- `package.json`へのscript追加、dependency追加、lockfile変更。
- TASK-CODEX-003以前のcompleted TASK、anchor、または履歴の変更。
- GPT-6 modernization以外の横展開変更。
- Google Sheet由来の承認仕様、同期生成物、traceability、product spec filesの変更。
- 権限、sandbox、approval、network、user-level Codex config、Desktop UI設定の変更。
- commit、push、TASK完了移動、anchor生成。これらは別承認があるまで実施しない。

## Change candidates

- `.codex/execution-profiles.json`
- `scripts/codex-profile.mjs`
- `scripts/codex-task.mjs`
- `tests/codex-profile.test.mjs`
- `tests/codex-task.test.mjs`
- `docs/codex-task.md`
- `tasks/active/TASK-CODEX-004.md`
- `tasks/completed/TASK-CODEX-004.md`
- `tasks/anchors/TASK-CODEX-004.json`
- `var/content-pipeline/task-codex-004/**` for TASK-local verification notes or logs only.

## Risks

- Candidate model names or reasoning efforts may not be accepted by the installed Codex CLI, account, or current release channel.
- Mocked spawn argument checks can prove launcher intent but cannot prove actual session application.
- Real session JSONL location or schema may differ by CLI version; verification must inspect actual generated session data and avoid assuming field names without evidence.
- Updating validation too broadly could weaken protected config checks, profile name validation, or TASK-CODEX-003 scope guard behavior.
- Documentation could drift from launcher behavior if tests only check mapping and not TASK launch integration.

## Acceptance criteria

- [x] AC-01: `.codex/execution-profiles.json` defines exactly the four supported profiles `light`, `standard`, `deep`, and `review` with the candidate model / effort pairs listed in this TASK.
- [x] AC-02: Existing profile schema validation still rejects missing profiles, unknown profiles, malformed model / effort values, and protected model / effort overrides.
- [x] AC-03: `pnpm run codex:task TASK-CODEX-004` continues to use TASK frontmatter `execution_profile` as the only TASK profile source and delegates to the existing profile launcher without a second profile override path.
- [x] AC-04: Required tests cover the updated candidate mappings for all four profiles and preserve TASK-CODEX-001 / 002 / 003 launcher and scope-guard regressions.
- [x] AC-05: For each profile, an actual Codex CLI session attempt is made through the repository launcher path, and the resulting session JSONL is inspected for effective `model` and reasoning `effort`.
- [x] AC-06: Session JSONL evidence shows `light = gpt-6-luna / low`, `standard = gpt-6-sol / medium`, `deep = gpt-6-sol / high`, and `review = gpt-6-astra / xhigh`; if any candidate is rejected or not observable, the TASK is marked BLOCKED with exact command, error, expected value, actual value, and JSONL path or absence.
- [x] AC-07: `pnpm run spec:check` passes after the profile modernization changes; `pnpm run spec` is not required and must not be added as a package script.
- [x] AC-08: Necessary impact tests pass at minimum: `node --test tests/codex-profile.test.mjs tests/codex-task.test.mjs`, plus any additional focused test touched by implementation.
- [x] AC-09: Before completion, run the standard full gate `pnpm run verify` and require PASS unless the TASK is BLOCKED earlier by CLI model acceptance/session evidence. FULL VERIFY is required because the profile launcher and TASK launcher are operational infrastructure.
- [x] AC-10: Final diff remains within this TASK's allowed paths and does not modify application product code, package scripts, dependencies, completed predecessors, or existing anchors.

Definition-only TASK creation does not satisfy the implementation acceptance criteria.

## Verification plan

At implementation start:

1. Confirm branch, HEAD, working tree, active / completed / anchor counts.
2. Run `pnpm run spec:check`.
3. Read the current `.codex/execution-profiles.json`, launcher code, TASK launcher code, and focused tests.

During implementation:

1. Update the mapping and the minimum necessary tests/docs.
2. Run focused tests:
   - `node --test tests/codex-profile.test.mjs tests/codex-task.test.mjs`
   - any additional focused tests required by modified code.
3. Run `pnpm run spec:check`.
4. For each profile, perform a real Codex CLI session attempt through the repository launcher path or the existing profile launcher path when TASK metadata cannot practically exercise all four values from one ACTIVE TASK. Record the exact command and inspect the actual session JSONL.
5. Verify session JSONL contains the expected effective `model` and reasoning `effort`. Do not treat UI display, documentation, or mock spawn arguments as the real-session proof.

Before completion:

1. Run `pnpm run lint` without auto-fix.
2. Run `pnpm run typecheck`.
3. Run `pnpm test`.
4. Run `pnpm run architecture:check`.
5. Run `pnpm run spec:check`.
6. Run `git diff --check` and confirm changed paths.
7. Run `pnpm run verify` as FULL VERIFY. If CLI model acceptance/session evidence blocks the TASK before completion, record BLOCKED instead of forcing FULL VERIFY to stand in for missing real-session proof.

`pnpm run spec` is explicitly not part of this TASK and must not be requested or created.

## Completion conditions

- AC-01 through AC-10 are all PASS, with real session JSONL evidence for the four profile mappings.
- `pnpm run spec:check` PASS after changes.
- Required focused tests and FULL VERIFY PASS, unless the TASK is formally BLOCKED before completion.
- Final changed files are limited to this TASK's `allowed_paths`.
- TASK status remains ACTIVE until the user separately authorizes completion movement and anchor generation.

## Rollback policy

If modernization must be reverted, restore only the mapping and any TASK-local code/test/doc changes made under this TASK's allowed paths. Do not use bulk reset/clean. Do not alter completed predecessor TASKs or existing anchors. Keep blocker evidence in this TASK unless the user explicitly asks to remove it.

## Blocker / stop conditions

- 開始時点でbranch、HEAD、working tree、active / completed / anchor件数、または `pnpm run spec:check` が基準として扱えない。
- 既存差分がTASK作成またはprofile modernizationのscope判定を妨げる。
- Candidate model name or reasoning effort is ambiguous at implementation time, or Codex CLI rejects one of the specified candidates.
- Session JSONL does not expose enough evidence to verify effective `model` and effort.
- Necessary changes require `package.json` script additions, dependency / lockfile changes, product code changes, completed predecessor edits, existing anchor edits, or spec generated file changes.
- Existing launcher, protected override, TASK metadata, or scope guard behavior cannot be preserved with a narrow change.
- New specification conflict or missing requirement appears; record `SPEC_GAP` with target, expected value, actual value, reference, and stop point.

## Progress

- [x] TASK file creation only.
- [x] Preflight baseline and all four CLI candidate model / effort pairs verified before mapping edits.
- [x] Candidate profile mapping updated; both launcher implementations and scope guard unchanged.
- [x] Regression tests and documentation updated.
- [x] Real session JSONL evidence collected for all four profile launches and the TASK launch.
- [x] Standard checks and FULL VERIFY completed.
- [x] Completion review PASS; formal lifecycle completion authorized on 2026-09-29 JST.

## Verification

TASK creation stage only:

- Start branch / HEAD: `main` / `9b39e6756e7a3a5d8c627f3137f9e4819ea2db66`.
- Start working tree: clean.
- Start active / completed / anchor counts: `0 / 21 / 21`.
- Start `pnpm run spec:check`: PASS, `SPEC_CHECK_OK`, `active_tasks: 0`.
- Created `tasks/active/TASK-CODEX-004.md` only.
- Implementation, profile updates, real session attempts, completion move, anchor generation, commit, and push are not performed in this stage.

Implementation verification on 2026-09-29 JST:

- Confirmed `main` / `9b39e6756e7a3a5d8c627f3137f9e4819ea2db66`, counts `1 / 21 / 21`, and only this new TASK in the initial working tree. Counts exclude `.gitkeep`.
- CLI `0.158.0-alpha.2.1`; executable `C:\Users\user\AppData\Local\OpenAI\Codex\bin\faa963e871dd422c\codex.exe`.
- Preflight: all four direct CLI probes returned the requested response with matching persisted model / effort, before changing the mapping. The first restricted-network attempt failed with `os error 10013`; approved execution of the same command succeeded without configuration changes.
- Actual application: all four `codex:profile` sessions match their expected values; no model fallback observed. The actual `pnpm run codex:task TASK-CODEX-004` session records `gpt-6-sol / high` from unchanged `execution_profile: deep`; its verification turn was interrupted after startup and `/quit` returned exit 0 through the existing postflight scope guard.
- Exact commands, limitations, source JSONL paths, hashes, line numbers, and observed fields: [verification notes](../../var/content-pipeline/task-codex-004/verification.md) and [session evidence](../../var/content-pipeline/task-codex-004/session-evidence.json).
- Focused profile / TASK / scope regression: 151/151 passed, no skips, exit 0.
- `pnpm run lint`: exit 0, no fixes; existing out-of-scope diagnostics remain (1 warning, 25 infos).
- `pnpm run typecheck` and `pnpm run architecture:check`: exit 0; `ARCHITECTURE_CHECK_OK`.
- Post-edit `pnpm run spec:check`: PASS, `SPEC_CHECK_OK`, `active_tasks: 1`; `git diff --check`: exit 0.
- `pnpm test`: exit 0, Node 310/310 passed, no skips.
- Initial FULL VERIFY: exit 1 at toolchain due to existing uv cache access denial (`os error 5`), after Node 310/310 and architecture PASS. Three standalone lock-check retries reproduced the access error; approved execution of the unchanged gate resolved it.
- FULL VERIFY: PASS, exit 0. Node 310/310; Python 636/636 (406.11 seconds); architecture, toolchain, DB integrity/backup, content validation, and spec all PASS. Log: `var/content-pipeline/task-codex-004/full-verify-approved.log`.
- AC-01 through AC-10: provisional implementation PASS. Both launcher source files and the shared scope guard remain unchanged.
- Scope: four modified tracked files (`.codex/execution-profiles.json`, `docs/codex-task.md`, `tests/codex-profile.test.mjs`, `tests/codex-task.test.mjs`) plus this untracked ACTIVE TASK; TASK-local notes, JSONL extracts, and gate logs are under the allowed ignored directory `var/content-pipeline/task-codex-004/`.
- Blocker: none remaining. Implementation defect: none found. The baseline lint diagnostics and CLI warnings are recorded in the verification notes.
- `TASK-CODEX-004 IMPLEMENTATION: PASS`. Status remains ACTIVE, counts remain `1 / 21 / 21`; no completion move, anchor, commit, or push.
- AC checkmarks are implementation evidence, not lifecycle completion approval.

Formal completion review and authorization on 2026-09-29 JST:

- `TASK-CODEX-004 COMPLETION REVIEW: PASS`; review session `01a0ed29-92e3-7943-a06f-8117a357ea18` records `source=exec`, `gpt-6-astra / xhigh`.
- AC-01 through AC-10 PASS; focused regression 151/151; FULL VERIFY exit 0 with Node 310/310 and Python 636/636; no repository defect found.
- Before lifecycle changes, all 219 file hashes matched the review postflight inventory recorded at line 240 of `C:\Users\user\.codex\sessions\2026\09\29\rollout-2026-09-29T21-35-20-01a0ed29-92e3-7943-a06f-8117a357ea18.jsonl`. Branch / HEAD remained `main` / `9b39e6756e7a3a5d8c627f3137f9e4819ea2db66`; counts were `1 / 21 / 21`, staged changes were empty, and `pnpm run spec:check` passed.
- The user separately authorized status `COMPLETED`, movement to `tasks/completed/TASK-CODEX-004.md`, and anchor creation through `node scripts/spec/task-anchors.mjs --write tasks/completed/TASK-CODEX-004.md`. Commit and push remain separate operations and were not performed.
