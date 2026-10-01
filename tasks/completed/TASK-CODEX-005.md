---
id: TASK-CODEX-005
status: COMPLETED
execution_profile: deep
spec_version: 2026.09.01-v1
source_fingerprint: sha256:17c2537bddb5bace8c8d2d39ceb6dae97be77f6301b923733277b55fe7915b6d
related_specs: [REQ-037, REQ-038, REQ-039, BAS-036, BAS-037, DET-074, DET-075, DET-076, DET-080, DET-086]
allowed_paths: [tasks/active/TASK-CODEX-005.md, tasks/completed/TASK-CODEX-005.md, tasks/anchors/TASK-CODEX-005.json, docs/codex-task.md, scripts/codex-task.mjs, scripts/codex-profile-selection.mjs, tests/codex-task.test.mjs, tests/codex-profile-selection.test.mjs]
forbidden_paths: [.codex/**, .agents/**, .git/**, .gitignore, AGENTS.md, README.md, package.json, pnpm-lock.yaml, scripts/codex-profile.mjs, scripts/spec/**, scripts/maintenance/**, docs/product-specs/**, docs/spec-manifest.yaml, docs/traceability.yaml, docs/spec-source/**, src/**, drizzle/**, tools/**, tasks/backlog/**, tasks/proposed/**]
acceptance_criteria: [AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16]
---

# TASK-CODEX-005 — TASK内容に基づくexecution profileの自動選択

## Goal

作業内容からexecution profileを安全・決定的に自動選択し、人間が毎回 `light / standard / deep / review` を指定する必要を減らす。有効な明示指定を最優先で維持し、完全省略時だけ選択処理を行う。抽象profileを既存launcherと唯一のmappingへ渡し、実sessionまで適用を検証できるようにする。

## Background / SPEC_GAP resolution

依存するTASK-CODEX-001〜004で、profile定義の一元管理、TASKからの起動、scope guard、実sessionのmodel / reasoning effort確認が成立している。依存TASKのcompleted本文とanchorは履歴として保持する。

旧契約は `execution_profile` が唯一の選択元で、完全省略も拒否していた。このため前回のTASK作成はSPEC_GAPで停止した。2026-09-30のユーザーによる「SPEC_GAP RESOLUTION + TASK CREATION」の正式承認を受け、`docs/codex-task.md` の契約を「有効な明示指定が最優先、完全省略時だけauto、不正指定は拒否」へ改訂することで解消する。

作成時の承認は文書改訂とTASK作成までで、その時点のlauncherは完全省略を `CODEX_TASK_PROFILE_REQUIRED` で拒否していた。その後、ユーザーの添付「TASK-CODEX-005 IMPLEMENTATION」により本TASK内の実装・検証を正式に承認された。commit・push・完了移動・anchor生成は引き続き未承認。

作成開始時: branch `main`、HEAD `5c6aa2b66213d41e49fa3ede3a2d66063da9aa59`、working tree clean、active / completed / anchor `0 / 20 / 20`、`pnpm run spec:check` は `SPEC_CHECK_OK`。

## Execution profile

本TASK自身は既存方式で `execution_profile: deep` を指定する。理由はCodex実行基盤・governance・安全な起動判定に関わる変更であるため。実model名とreasoning effort値は本TASKへ複製せず、`.codex/execution-profiles.json` を参照する。このmetadataは現在のDesktop sessionへの適用証明ではない。

## Scope

- 今回の作成工程で変更するのは本TASKと `docs/codex-task.md` の2ファイルだけ。
- 実装承認に従い `scripts/codex-task.mjs` に省略時の選択経路を追加し、決定的な分類を `scripts/codex-profile-selection.mjs` に分離する。対応する2テストファイルと本TASK・運用文書を更新する。
- 既存のstrict parser、scope検査、`runCodexForProfile` とprofile mappingを再利用する。selectorが直接Codexをspawnする経路を作らない。
- 前後のscope guardをそのまま経由し、開始時TASK snapshot・選択結果・scopeを起動単位で固定する。
- 自TASKのcompleted pathと専用anchorは将来の正式な完了手順のためだけにallowlistへ記載する。今回も実装時も、別承認なしに完了移動・anchor生成を行わない。
- allowlistにない他TASK、既存anchor、共通governance、profile launcherを変更しない。必要になればscopeを勝手に拡張せずBLOCKEDとする。

## Selection policy / design requirements

### 明示指定と省略の分離

1. 既存strict parserでfrontmatterを検証する。構文エラーや重複を修復しない。
2. `execution_profile` keyが存在する場合は、単一の有効profileを既存経路へ渡す。本文と競合しても自動判定で上書きしない。有効な `light` 明示と高リスク本文の組合せもこの優先順位を維持し、scope等の安全gateは適用する。
3. 空文字・空白だけ・配列・未知名・不正型・重複・曖昧な指定は非0終了・spawn 0。本文のprofile指定例やCLI追加引数を第二のoverride元にしない。
4. keyが完全に存在しない場合だけ自動選択する。truthy/falsyだけで省略を判定しない。自動結果をTASKへ書き戻して暗黙の明示指定へ変えない。

### 自動分類の優先順位

| 条件 | 結果 | 必要な根拠 |
| --- | --- | --- |
| 独立した正式なcompletion / architecture / security review、重大変更の最終判定 | review | Goal・ACでレビューが主目的と確認でき、製品や実装の修正を同工程に含まない。レビュー報告の記録は許容する |
| 実装・調査に高リスク要素がある | deep | architecture、security、データ破壊、migration、concurrency、認証・認可、governance、scope/specification、安全機構、Codex基盤、複雑なbug、複数機能・レイヤーへの変更のいずれか |
| 実装修正と正式な最終reviewを同TASKが要求する | deep | 実装側のprofileを選択し、正式reviewは独立工程として扱う。review名称だけで実装をreviewへ流さない |
| 高リスクがなく、局所的で動作・設計へほぼ影響しない軽作業と確認できる | light | typo、文言、コメント、小規模文書、明確な単純修正について本文・AC・scopeが一致する |
| 高リスクがなく、既存設計内で限定された通常開発と確認できる | standard | 小〜中規模の機能追加、通常bug修正、テスト追加、限定された複数ファイル変更 |
| 根拠不足、目的・scopeの矛盾、分類不能、selector失敗 | 起動拒否 | 非0終了・spawn 0。理由と不足する入力を提示し、人間の修正または有効な明示指定後に再起動する |

- 自動判定内では高リスク条件がlight / standardより優先する。ファイルが1件でも安全機構やsecurityを変更するならdeep。判定不能をlightやstandardへ流すdefault分岐を置かない。
- TASK本文、Goal、AC、allowed / forbidden scope、予定変更ファイル数または変更範囲、機能・レイヤーの広がり、review / 実装の目的を判定材料にする。単なる語の有無や本文の「lightでよい」という自己申告をauthorityにしない。
- scopeの解釈は既存matcherとforbidden優先の契約を守る。禁止領域にsecurityという語があるだけで変更予定と扱わず、除外後の対象とACを照合する。ただし広いglobで対象が確定しない場合、少数件と推定してlightにしない。
- 現在のgit diffが空でも将来の変更規模がゼロとは扱わない。宣言された変更対象・範囲を基本とし、globや新規pathを件数へ換算できないときは「不明」を維持する。自TASKの管理用pathと実際の変更対象を区別し、全TASKが管理pathを持つだけでdeepにならないようにする。
- 実装前の設計工程で、本文/ACの抽出方法、対象path分類、規模境界、競合優先順位、理由の形式、安定したerror codeを決定表とfixtureへ固定する。未確定な仕様判断が残ればSPEC_GAPとして停止する。
- deterministicなルールと明示的risk escalationを基本とする。限定的な意味判定を検討する場合も同じ入力から再現可能な根拠を返せる範囲に限り、自由なAI推測、外部AI API、新依存、ネットワークを必要条件にしない。
- 成功時は `selected_profile` と `selection_source: explicit | auto`、auto時は `selection_reason` を確認可能にする。理由は適用した規則と本文/AC/pathの根拠を追跡できる形にし、同じ入力・設定・規則で同じprofileと理由を返す。

## Safety / compatibility requirements

実装時に確定した決定表・入力書式は `docs/codex-task.md` の「auto入力の書式と保証範囲」「決定表」を正とする。autoはfrontmatterのexact `change_targets`、Goal直下の単一Intent、AC直下のchange/risk markerとAC ID集合、effective scopeを照合する。自由文の自然言語分類は実行しない。不明markerやmarker欠落は拒否し、explicitでは追加書式を要求しない。

規模境界は非リスク・非動作変更1〜3対象をlight、通常変更および4〜10対象をstandard、11対象以上をdeepとする。局所変更の本文/補足/テスト程度を3対象、通常範囲を最大10対象に保守的に限定する運用値であり、実測難易度の推測ではない。2/3/4・9/10/11をテストする。risk markerと基盤/仕様/security/migration path、複数レイヤー/機能ディレクトリは件数より優先する。独立reviewのみreview、実装とreview混在はdeep。不明なglob範囲は拒否する。

独立reviewの変更scopeは自TASK管理pathと `docs/reviews/` のMarkdown報告に限定する。表記pathと実体pathを両方検査し、引用・fence・HTMLコメント・子sectionを根拠から除外する。TASK snapshotと同じpath解決結果に対し結果・理由を安定順にする。説明出力はstderrのJSON 1行で、selected_profile / selection_source / reason_codes / selection_reasonを返す。`CODEX_TASK_PROFILE_UNDETERMINED` は根拠不足・矛盾、`CODEX_TASK_PROFILE_SELECTION_FAILED` は内部例外・未知戻りprofileで、いずれもspawn 0。

- `.codex/execution-profiles.json` はmodel / effort mappingの唯一の正本。selectorは抽象profileだけを返し、TASK・selectorに実model名やeffort値を重複保存しない。将来mappingが変わってもTASKや分類ロジックを書き換えない。
- 既存の明示4profile、未知値・不正metadataの拒否、TASK IDだけのCLI、二重指定拒否、保護設定override拒否、shellなしspawn、終了値伝播を維持する。
- 完全省略の一律拒否とauto経路で本文を参照しない旧契約だけが今回承認された変更。既存の有効explicit TASKは再分類しない。TASK-CODEX-001〜004のcompleted履歴とanchorを修正・移行しない。
- 既存テストを削除・skipして通過させない。旧「missing profile」の期待値等、承認済み契約変更に直接対応する箇所だけを根拠付きで更新する。根拠不足の省略fixtureは引き続き起動拒否とし、十分な根拠を持つauto成功fixtureを追加する。explicit時の本文非参照は維持する。
- TASK-CODEX-003のpreflight/postflight、起動時scope固定、HEAD差分、rename/copy両端、forbidden優先、symlink/junction・repo外・Git異常拒否を維持する。auto判定成功をscope検査の代わりにしない。
- profileは権限を与えない。reviewをread-only権限と見なさず、sandbox・approval・network・commit/push権限を変更しない。起動中の自動profile切替を行わない。

## Acceptance Criteria

- [x] AC-01: 有効なexplicit 4profileが従来どおり選ばれ、競合する本文・高リスク条件でも上書きされない。selection_sourceはexplicit。
- [x] AC-02: strict検証後にkeyが完全省略された場合だけautoへ進む。空・空白・配列・未知値・不正型・malformed frontmatter・同値/異値重複は非0終了・spawn 0で、autoによる救済がない。
- [x] AC-03: 本文・AC・scopeが一致する明らかな軽作業はlightとなる。typo/文言/コメント/小規模文書のfixtureを含む。
- [x] AC-04: 既存設計内の通常実装・通常bug修正・テスト追加・限定された複数ファイル変更はstandardとなる。
- [x] AC-05: architecture/security/governance/Codex基盤/scope/specification、安全機構、migration、データ破壊、concurrency、認証・認可、複雑なbug、複数機能・レイヤーの変更はautoでdeepとなる。1ファイルやtypo併記でも降格しない。
- [x] AC-06: 独立した正式completion reviewとarchitecture/security reviewはreviewとなる。本文中の単なるreview言及は根拠にせず、実装と最終reviewの混在はdeepで独立review工程を要求する。
- [x] AC-07: 判定不能・入力不足・目的/scope矛盾・selector失敗は非0終了・spawn 0となり、軽いprofileへのfallbackがない。理由と必要な修正を確認できる。
- [x] AC-08: 自動結果は既存4profileだけ。既存launcher経由でmappingを取得する。隔離testのmappingだけを変更して追従を検証し、TASK/selectorのmodel名変更が不要であることを確認する。
- [x] AC-09: 同一TASK内容・設定・規則で選択結果と理由が決定的。時刻・ランダム・外部AI応答に依存しない。対応するLF/CRLFや入力列挙順の扱いを固定しテストする。
- [x] AC-10: 成功時にselected_profileとselection_source、auto時に根拠付きselection_reasonが確認できる。表示を実session適用成功の証明と混同せず、TASKを自動書換えしない。
- [x] AC-11: 本文・AC・allowed/forbidden scope・予定規模・リスク・作業目的を組み合わせる決定表を実装前に明文化する。否定/引用/例示/非対象内の語、広いglob、未知規模、新規path、閾値の直前/一致/直後、複数カテゴリ競合をfixtureで検証する。
- [x] AC-12: TASK-CODEX-001〜004の既存explicit契約と安全保証を維持する。回帰テストが成功し、既存テストの意図的な期待値変更は本TASKで承認された契約差分へ追跡できる。
- [x] AC-13: auto/explicit両経路でscope guardとspec gateを迂回しない。preflight違反時spawn 0、child成功後のpostflight違反も全体非0、起動時scope・HEAD差分・rename/link保護を維持する。
- [x] AC-14: TASK ID以外のCLI引数、二重profile指定、model/effortの保護設定overrideを従来どおり拒否する。scope・profile変更が必要なら停止して再起動する。
- [x] AC-15: 実Codex sessionで期待するmodel / reasoning effortを確認する。選択元・profile・TASK snapshot・起動commandとsession IDを対応付け、実JSONLのsession_metaとturn_contextを当該mappingへ照合する。auto経路の実起動証跡を最低1件含め、4profileの適用を確認する。欠落・不一致・拒否・fallbackはBLOCKED。
- [x] AC-16: 実装後にlint（read-only）・typecheck・test・architecture:check・spec:checkが成功し、正式完了前の最新pnpm run verifyが成功する。変更がallowlist内で、別承認なしの完了移動・anchor・commit・pushがない。

## Out of Scope

- 今回のTASK作成工程でのコード・テスト変更、auto-selector実装、実Codex検証sessionの起動。
- profile mapping、実model名、reasoning effort値、profile種類の変更。
- 共通TASK parser、scope matcher、spec/governance gateの意味変更または安全保証の弱体化。
- Google Sheet、同期生成仕様、manifest/fingerprint/traceabilityの変更。
- 勉強アプリ本体、DB、教材pipeline、依存追加、package scripts、外部/有料AIサービス、無関係refactor。
- Desktop設定操作、実行中sessionの自動切替、別TASK/subagentの自動起動、後続TASKの作成。
- TASK-CODEX-006以降、commit、push、completed移動、anchor生成（別承認まで実施しない）。

## Fail-closed / SPEC_GAP handling

新たな重大仕様衝突、TASK-CODEX-004までの安全保証の破壊、scope外変更の必要、予期しない変更、spec:check失敗があれば停止しBLOCKEDとする。失敗のcode・対象・期待値・実値・参照箇所・必要判断・停止工程を本TASKまたは報告へ記録する。未知差分を修正・取り消ししない。同期仕様を独断で編集しない。

auto判定不能は定義済みの通常の拒否動作であり、実装者の仕様不足とは分ける。分類規則自体を一意に定義できない場合はSPEC_GAPで停止し、曖昧さをdefault profileで隠さない。

## Verification

### 今回のTASK作成

- 開始前と作成後: `pnpm run spec:check`。
- 作成後: `git diff --check`、新規untracked TASKの内容・空白確認、branch / HEAD / `git status --porcelain=v1 --untracked-files=all`、変更2ファイルのみ、active/completed/anchor件数を確認する。
- コード変更を行わないため、この工程では実装ACの達成やfull verify成功を主張しない。

作成時の確認結果（2026-09-30）:

- `pnpm run spec:check`: 開始前・作成後とも `SPEC_CHECK_OK`、active_tasksは0→1。
- `git diff --check`: exit 0。新規TASKも `git diff --no-index --check -- NUL tasks/active/TASK-CODEX-005.md` で空白エラーなし（新規差分のexit 1とLF→CRLFの通知のみ）。
- branch / HEADは開始時から不変。working treeは `M docs/codex-task.md` と `?? tasks/active/TASK-CODEX-005.md` の2件のみ。
- active / completed / anchorは `1 / 22 / 22`（review findings修正時の2026-09-30再実測で検証記録を訂正。`.gitkeep`を除くMarkdown TASK / JSON anchorを集計）。コード・mapping・既存TASK・anchorの変更なし。

### 実装承認後

- 開始前にAGENTS → spec index → 本TASK → related_specs → 関連コード/テストを読み、`pnpm run spec:check`。
- focused tests: `node --test tests/codex-profile-selection.test.mjs tests/codex-task.test.mjs tests/codex-profile.test.mjs tests/spec/task-scope.test.mjs tests/spec/sync-governance.test.mjs`。
- `pnpm run lint`（自動修正なし）、`pnpm run typecheck`、`pnpm test`、`pnpm run architecture:check`、`pnpm run spec:check`。正式完了前に最新の `pnpm run verify` と差分確認を実施する。
- 実session検証では実CLI versionと実JSONL schemaを調べ、session ID・cwd・model・effortを確認する。mockやUI表示、別の過去sessionを代用しない。4profileの検証には既存codex:profileを併用できるが、それだけでauto経路の実適用証明とはしない。
- auto実起動用TASK snapshotはscope内の隔離fixture、または作業終了後の明示的な検証用再起動計画として設計する。本番TASKのdeep指定や起動時scopeを実装session中に書換えて検証しない。安全な実証方法が成立しなければBLOCKED。
- mapping追従テストは一時fixture内だけで実施し、repoの `.codex/execution-profiles.json` を変更しない。

## 実session検証結果（2026-09-30）

profileを省略した隔離TASK fixtureを4種類作成し、本repositoryの `runCodexForTask` → selector → `runCodexForProfile` → 正本mapping → 実Codexへ通した。テスト用spawn adapterはmock応答を返さず、既存のmodel/config引数とTASK promptをそのまま渡し、非対話検証用の `exec --json --sandbox read-only` だけを挿入した。親launcherのpreflight/postflightを通過し、4件ともexit 0、fixtureのgit statusは空、TASK hash不変、最終応答はPROFILE_SESSION_OK。

実CLI versionは `0.158.0-alpha.2.1`。session_metaのID/cwd/source=execとturn_contextのcwd/model/effortを読んだ。各profileのexpectedは正本mappingから取得し、actualが全件一致した（値を本TASKへ重複保存しない）。JSONLは `C:/Users/user/.codex/sessions/2026/09/30/` 配下。

| profile / source | session ID | JSONL filename | 結果 |
| --- | --- | --- | --- |
| light / auto | 01a0ee91-bfae-7f43-b74e-d1093f8fde36 | rollout-2026-09-30T04-08-44-01a0ee91-bfae-7f43-b74e-d1093f8fde36.jsonl | model/effort一致 |
| standard / auto | 01a0ee92-97c1-7843-a340-c30886961088 | rollout-2026-09-30T04-09-39-01a0ee92-97c1-7843-a340-c30886961088.jsonl | model/effort一致 |
| deep / auto | 01a0ee92-cb48-7ef1-82a0-0da0f272c4ff | rollout-2026-09-30T04-09-52-01a0ee92-cb48-7ef1-82a0-0da0f272c4ff.jsonl | model/effort一致 |
| review / auto | 01a0ee93-2728-7ed2-9434-1fbaea4ca595 | rollout-2026-09-30T04-10-16-01a0ee93-2728-7ed2-9434-1fbaea4ca595.jsonl | model/effort一致 |

一時証跡は `C:/Users/user/AppData/Local/Temp/task-codex-005-session-verification.json`。元command/引数、TASK hash、選択理由、expected、session IDは同Temp配下の `task-codex-005-live-light-mTVi2n` / `task-codex-005-live-standard-7487h4` / `task-codex-005-live-deep-ItadJE` / `task-codex-005-live-review-Dnlq0e` のreceipt.json・stdout.jsonlに保持する。

最初のsandbox内light試行はsocket制限（os error 10013）でCLI内の再試行が失敗し、180秒でtimeout。実行権限を得て同じ検証を再試行し、上記の成功証跡を取得した。model/effortの変更やfallbackで回避していない。本番TASKのdeep指定とscopeは変更していない。

## 最終Verification（2026-09-30）

- AC-01〜AC-16: PASS。分類・優先順位・不正値・決定性・境界・mapping分離はselector tests、起動/説明出力/実scope/異常時spawn 0はTASK launcher tests、既存profile/scope/spec testsで後方互換性を確認。AC-15は上記4実sessionのJSONL照合で確認。
- targeted command（本Verificationに記載した5ファイル）: 273 tests / 273 PASS。Markdown例示の取扱いを最終調整後、selector testsも81/81を再確認し、最新full verifyで全体を再検証。
- `pnpm run lint`: exit 0、自動修正なし。既存の1 warning・25 infosは今回修正しない。
- `pnpm run typecheck`: exit 0。`pnpm test`: 412/412 PASS。`pnpm run architecture:check`: ARCHITECTURE_CHECK_OK。
- 最新 `pnpm run verify`: exit 0。Node 412/412、Python 636/636（419.59秒）、architecture・toolchain・DB・content・specすべてPASS。ログ: `C:/Users/user/AppData/Local/Temp/task-codex-005-verify-final.log`。
- 初回verifyはuv共用cache、再試行は既存pytest一時directoryへのWindowsアクセス拒否で停止。テストassertionの不一致ではない。権限を得て同じ正式コマンドを実行し、上記の完全成功を確認した。コードや依存・設定の変更で回避していない。
- `pnpm run spec:check`: SPEC_CHECK_OK、active_tasks: 1。`git diff --check`: exit 0。新規untracked 3ファイルも空白・内容を確認する。
- branch `main`、HEAD `5c6aa2b66213d41e49fa3ede3a2d66063da9aa59` は開始時から不変。変更はdocs/codex-task.md、scripts/codex-task.mjs、scripts/codex-profile-selection.mjs、tests/codex-task.test.mjs、tests/codex-profile-selection.test.mjs、本TASKの6件だけ。全件allowed_paths内、scope逸脱なし。
- active / completed / anchor = 1 / 22 / 22（review findings修正時に再実測して訂正）。mapping・共通scope/spec実装・既存completed/anchorは不変。commit・push・完了移動・anchor生成なし。

## Review findings修正（2026-09-30）

- 前回の正式completion reviewはBLOCKED。上記の実装時PASS記録とは別に、AC-07の2不具合とAC-11の件数記録だけを今回修正する。launcher / profile定義 / mappingは対象外。
- AC-07の原因1: 見出し検出が行頭の空白を許容せず、子sectionがGoal / ACの直下として残った。ATX見出しの0〜3スペース、空白/タブ区切り、空見出しを共通の境界検出で扱い、level 2以外で分類対象sectionを終了する。
- AC-07の原因2: HTMLコメントの状態を行内の開始/終了文字列の有無だけで上書きし、後続コメントが次行へ続く状態を失った。全delimiterを左から順に走査して開閉状態を次行へ引き継ぐ。コメントに接触する行全体の除外とfence内のコメント文字列の扱いは維持する。
- 回帰テスト25件を追加（selector 21件、TASK launcher 4件）。インデント0〜3・子見出しlevel 3〜6、Intent/ACの混入防止、複数/複数行/未閉鎖コメント、通常の有効入力の選択結果と理由の維持、実Node processでexit 1 / spawn 0を検証。既存期待値・skipは変更なし。修正前は新規25件中24件FAIL、1件PASSを確認。
- 開始前 `pnpm run spec:check`: SPEC_CHECK_OK。開始時branch `main` / HEAD `5c6aa2b66213d41e49fa3ede3a2d66063da9aa59`。既存差分は本TASK関連6ファイルのみ。
- `pnpm run spec`: exit 1 / ERR_PNPM_NO_SCRIPT（package.jsonにspec定義なし）。正式仕様ゲートは既存の `pnpm run spec:check`。package scriptsは変更しない。
- 修正後検証: selector 102/102 PASS、関連5ファイルのfocused tests 298/298 PASS（既存273 + 新規25）。
- 初回full verifyはlint / typecheck / Node 437/437 / architectureまで成功後、toolchainの `uv lock --check --project tools/content-pipeline` がuv共有cacheのアクセス拒否（os error 5、exit 2）で停止した。同じ失敗commandを3回再試行して再現を確認し、追加実行権限で同じ `pnpm run verify` を再実行したが、ユーザーの停止指示で中断した。その後の再開指示を受け、scope / specを再確認してfull verifyを最初から実行。依存・cache設定・コードの変更による回避は行っていない。
- 最新 `pnpm run verify`: exit 0。Node 437/437、Python 636/636（456.73秒）、lint（read-only、自動修正なし、既存1 warning / 25 infos）、typecheck、architecture、toolchain、DB、content、specすべてPASS。ログ: `C:/Users/user/AppData/Local/Temp/task-codex-005-review-fix-verify-resumed.log`。
- FIX RESULT: PASS（指定されたreview findingsの修正・検証結果）。正式completion reviewの再判定は別review profileセッションで行う。
- 終了時確認: branch `main` / HEAD `5c6aa2b66213d41e49fa3ede3a2d66063da9aa59`、active / completed / anchor = `1 / 22 / 22`。今回の変更はselector・既存selector test・既存TASK launcher test・本TASKの4ファイル。開始前からのdocs/codex-task.mdとscripts/codex-task.mjsはハッシュ一致で保持。working tree全体は本TASK関連の既存6ファイルのみ。新規ファイル追加なし、scope逸脱なし。
- 最終 `pnpm run spec:check`: SPEC_CHECK_OK。`git diff --check`: exit 0。untrackedファイルを含む今回4ファイルの開始時snapshotとの差分も空白エラーなし。commit・push・completed移動・anchor生成・新規TASK作成・execution profile定義やmodel / effort mappingの変更は行っていない。

## Plan

1. 文書改訂とTASK作成・検証（完了）。
2. 実装承認に基づく決定表・境界・根拠抽出・拒否codeの具体化（完了）。
3. selector・launcher統合、境界/回帰テスト、実session検証（完了）。
4. 最新full verifyと最終AC判定を記録し、実装検証完了で停止。独立した正式review、完了処理、deliveryは別工程。

## Progress

- 現行仕様、TASK launcher、関連テスト、profile mappingを再確認済み。
- 前回SPEC_GAPはユーザーの正式な契約改訂承認で解消。文書改訂とTASK作成・検証が完了。
- 実装開始前に指定の2差分を確認し、spec:check成功。中断・再開時も本チャット由来の6ファイル以外の差分なし。
- selector、TASK launcher統合、分類/境界/安全回帰テストを実装。既存テストは「missing profile without classification evidence」の拒否codeだけを承認済み契約へ更新し、他の既存検証は維持した。
- targeted tests 273/273、全Node tests 412/412、全Python tests 636/636、4profileの実session照合、最新full verifyが成功。実装ACは16/16 PASS。
- 正式reviewの指摘修正後はselector 102/102、focused 298/298、Node 437/437、Python 636/636とfull verifyが成功。今回のFIX RESULTはPASSで停止し、別セッションの正式completion reviewを待つ。

## Decisions

- 本TASK作成時のprofileは既存方式のdeep。
- 明示指定が最優先。自動選択は完全省略時限定。不正指定と省略を区別する。
- autoの不明ケースは起動拒否。高リスク実装はdeep、独立した正式reviewはreview。
- モデル対応の唯一の正本と既存scope/spec保護を維持する。

## Remaining

- 正式completion reviewとcompletion gateはPASS。ユーザー承認に基づき正式完了処理を実施。
- commit・pushは未実施。別承認を待つ。

## 正式完了記録（2026-10-01）

- TASK-CODEX-005 COMPLETION GATE: PASS。AC-01〜16 PASS。独立review session 01a0f369-fb62-7760-9d09-cd4a691b82c1の実JSONLと既存レビュー結果を確認。
- 直近の診断で変更なしのpnpm run verifyが3回連続exit 0。各回Node 437/437、Python 636/636 PASS。証拠: C:/Users/user/AppData/Local/Temp/task-codex-005-wer-20261001/REPORT.md とrun-1〜3のログ・終了記録。
- Root Cause未特定、過去FAILおよび本TASKとの因果関係はNOT PROVEN。原因特定はAC上の完了必須条件ではない。
- completion gate時のspec:checkとgit diff --checkは成功。branch main、HEAD 5c6aa2b66213d41e49fa3ede3a2d66063da9aa59、承認済み6ファイルのSHA-256一致、staged変更なし。
- ユーザーがCOMPLETEDへの状態更新・completed移動・既存generatorによる専用anchor生成を承認。実装変更・追加再現試験・commit・pushは行わない。
