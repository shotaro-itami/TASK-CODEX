# TASKのexecution profileでCodex CLIを起動する

承認済みACTIVE TASKの既存frontmatterで抽象profileを明示指定できる。以下は記載例。

```yaml
execution_profile: deep
```

有効名は `light` / `standard` / `deep` / `review`。実model名やreasoning effort値をTASKへ書かず、対応は `.codex/execution-profiles.json` のみで管理する。

## 承認済みのprofile選択契約（TASK-CODEX-005）

2026-09-30のユーザー承認により、明示指定を維持し、完全な省略時だけ自動選択を行う契約へ拡張した。実装・検証記録は [TASK-CODEX-005](../tasks/active/TASK-CODEX-005.md) を参照する。`scripts/codex-profile-selection.mjs` が抽象profileを選び、既存launcherが唯一のmappingで実行値へ変換する。

- 有効な単一の `execution_profile` が存在すれば最優先で使用する。本文・リスクからの自動判定で上書きしない。
- strictなfrontmatter検証を通過し、`execution_profile` keyが完全に存在しない場合だけ、自動選択へ進む。
- 空値、未知名、不正な型、malformed frontmatter、重複（同じ値を含む）・曖昧な指定は拒否する。不正指定を省略扱いにして自動補正しない。CLIからの追加指定も引き続き拒否する。
- 自動選択はTASK本文、Acceptance Criteria、allowed / forbidden scope、予定変更範囲・規模、作業種別、高リスク要素を組み合わせた決定的ルールを用いる。単語の出現だけやAIの自由な推測で決めない。
- 自動判定は、独立した正式な完了・architecture・security reviewなら `review`、実装・調査でarchitecture、security、データ破壊、migration、concurrency、認証・認可、governance、scope/specification、安全機構、Codex基盤、複雑なbug、複数機能・レイヤーへの影響があれば `deep` を選ぶ。実装と最終reviewを含むTASKは実装側を `deep` とし、最終reviewは独立工程に分ける。
- 高リスクがなく、低リスク・局所的・非動作変更と確認できる軽作業は `light`、既存設計内で影響が限定された通常実装は `standard`。自動判定の複数実装カテゴリ競合は高リスク側を優先し、件数の少なさでリスクを相殺しない。
- 判定材料の不足、作業目的や影響範囲の矛盾、判定処理の失敗は非0終了・Codex spawn 0。最弱profileや任意profileへのfallbackを行わない。分類の詳細、根拠の取り方、境界値はTASKの設計・fixtureで固定する。
- 選択結果は既存4profileに限定する。`selected_profile` と `selection_source: explicit | auto` を表示し、自動選択では根拠付きの `selection_reason` を表示する。同じTASK・設定・判定規則に対する結果と理由は再現可能とする。
- 能力選択は既存のscope guard、spec gate、権限管理を置換しない。明示指定が低いprofileでも承認された優先順位を維持し、安全性は既存gateで検証する。

互換性の意図的な変更は「完全な省略時の一律拒否」と「自動選択経路で本文を参照しない」の2点に限定する。既存の明示指定経路、無効値拒否、mapping、scope、起動・終了契約は維持し、completed TASK・anchorは履歴として変更しない。

### auto入力の書式と保証範囲

明示profileのあるTASKに追加metadataは不要。省略時には次のように作業の性質を記述する。profile名を本文で指定する方式ではない。既存のid/status/spec_version/source_fingerprint等の必須metadataは引き続き必要。

```markdown
---
id: TASK-EXAMPLE
status: ACTIVE
acceptance_criteria: [AC-01]
allowed_paths: [tasks/active/TASK-EXAMPLE.md, docs/guide.md]
forbidden_paths: []
change_targets: [docs/guide.md]
---

## Goal
Intent: maintenance
案内文の誤字を直す。動作や設計を変更しない。

## Acceptance Criteria
- [ ] AC-01: [change:typo] [risk:none] 案内文の誤字だけが修正される。
```

- `change_targets` は既存flat frontmatterの配列書式で具体的なrepository-relative pathを列挙する。重複・glob・scope不一致は拒否する。対象はforbiddenを除いたexact allowed scopeと一致させ、自TASKのactive/completed/anchorの3pathだけを管理用として除く。
- 有効範囲に残るglobは規模不明として拒否する。allowedと完全一致するforbidden式は除外できるが、一般的なglob差集合を推測しない。ファイルを列挙して現在0件だから軽作業と判断せず、新規pathも1対象として数える。
- `## Goal` 直下に説明文と、1行だけの `Intent: maintenance | implementation | investigation | independent-review | implementation-and-review` を記す（実際には1値だけ）。
- `## Acceptance Criteria` 直下の各ACを上記の1行書式で記す。AC ID集合はfrontmatterの `acceptance_criteria` と重複なく完全一致させる。チェック状態は空白またはx/Xを許す。
- changeは `typo / wording / comment / documentation / feature / bugfix / test / refactor`、下記risk名、または `completion-review / formal-review / final-verification / architecture-review / security-review` の単一値。
- riskは `none` 単独、または `architecture / security / specification / governance / scope-guard / destructive-operation / complex-bug / cross-feature / cross-layer / migration / concurrency / authentication / authorization / execution-infrastructure / repository-wide` のカンマ区切り。重複、noneとの混在、未知値、説明部分での追加markerは拒否する。
- 引用、fenced code、HTMLコメント、子見出しの例示、別sectionは判定根拠にしない。見出し重複、閉じていないfence/comment、Goal/AC不足や不正markerも拒否する。自由文から不足markerを補完しない。
- 自由文の自然言語としての真偽・全意味を証明する仕組みではない。TASK作成時に説明とmarkerを一致させる。`security documentation typo` の語だけではriskにならず、markerと実際の対象path・scopeを組み合わせる。自動選択の対象書式にできないTASKは有効な明示profileを使用する。

### 決定表（上から優先）

| 条件 | 判定 |
| --- | --- |
| valid explicit | 指定profile。auto入力を評価しない |
| invalid explicit / 不正TASK / auto根拠不足・矛盾 | 起動拒否 |
| independent-review、全ACがreview種別、変更対象は `docs/reviews/` のMarkdown報告または自TASK管理用pathのみ | review |
| 上記以外でreview ACとIntentが矛盾 | 起動拒否 |
| implementation-and-review、実装ACとreview ACの両方がある | deep。最終reviewは独立工程 |
| risk marker、risk名のchange、下記の対象pathリスク、複数レイヤー/機能ディレクトリ、11対象以上 | deep |
| investigationでrisk根拠なし | 起動拒否 |
| maintenanceに動作変更ACを混在 | 起動拒否 |
| 全ACがtypo/wording/comment/documentation、riskなし、1〜3対象 | light |
| 通常change、または4〜10対象の非動作変更でriskなし | standard |

3対象は局所的な本文・補足・テスト等を含められるlight上限、10対象は通常変更を保守的に限定するstandard上限として固定する。実測難易度を推定する数値ではない。対象path数の2/3/4、9/10/11をテストし、リスクがあれば件数による降格を許さない。

対象pathのリスク引上げは、`.codex/`・`.agents/`・`scripts/codex-`がexecution-infrastructure、`AGENTS.md`・`scripts/spec/`・`scripts/maintenance/`・他TASKがgovernance、`docs/product-specs/`・`docs/spec-*`・`docs/traceability.yaml`・`docs/codex-task.md`がspecification、`drizzle/`・`scripts/db/`・migration(s)のpath segmentがmigration。`src/`・`scripts/`・`tools/` 下のsecurity/auth/authentication/authorization segmentはsecurityとする。Windowsではrisk用pathの大小文字を正規化するが、既存scope matcherの意味は変更しない。

`src/{domain,application,infrastructure,presentation}/` の複数レイヤー、またはその直下の複数機能ディレクトリを跨ぐ場合もdeep。既存linkは表記と解決先をscope照合し、両方のpathリスクを評価する。判定はTASK snapshotと同一のpath解決結果で決定的とし、path/AC/riskの列挙順・LF/CRLFを正規化する。実行中にselectorを再評価しない。

### 選択結果と拒否code

preflight通過後、起動前にstderrへJSON 1行で `selected_profile`、`selection_source`、ソート済みの `reason_codes`、`selection_reason` を出す。例として `risk:governance` と対象path、`change:typo` とAC IDが根拠を示す。explicitにも選択元を表示する。これは選択の証跡であり、CLI接続・実session適用の成功通知ではない。stdoutを診断で汚さず、TASKへ結果を書き戻さない。

autoの不足・矛盾は `CODEX_TASK_PROFILE_UNDETERMINED`、selector内部例外または未知の戻りprofileは `CODEX_TASK_PROFILE_SELECTION_FAILED`。既存のmetadata・scope・mapping errorは従来のcodeを維持する。いずれも非0終了・spawn 0で、default profileはない。

## 起動

`C:\アプリ\勉強アプリ\study-app` を作業ディレクトリにして、開始前の正式gateを実行してからTASK IDだけを指定する。

```powershell
pnpm run spec:check
pnpm run codex:task TASK-CODEX-005
```

`scripts/codex-task.mjs` が `tasks/active/<TASK-ID>.md` から明示指定、または省略時のautoで選んだ抽象profileを、既存の `runCodexForProfile` へ渡す。既存launcherが正本JSONを検証し、model/reasoningを解決してshellを介さずCodexを起動する。初期promptには対象TASKのpathと、そのscope・検証・完了手順に従う指示を渡す。

TASK起動commandは引数1個だけを受け取る。profile、追加prompt、Codex option、subcommand、`--` 等の追加引数は受け取らない。CLI側にもう一つのprofile選択元を持たせないための契約である。一般用途の既存 `codex:profile` commandの契約はそのまま維持するが、TASKとの一致保証が必要な作業には `codex:task` を使う。

## 起動前の拒否

- 空・配列: `CODEX_TASK_PROFILE_REQUIRED`。profile完全省略は上記の自動選択契約を適用する。
- 未知profile: 既存launcherの `CODEX_PROFILE_UNKNOWN`。
- 引数不足・追加引数・TASK ID以外のpath: `CODEX_TASK_USAGE`。
- repo root以外: `CODEX_TASK_CWD_INVALID`。
- activeなし・複数active・別TASK指定: `CODEX_TASK_ACTIVE_MISMATCH`。
- frontmatterなし・metadata重複・形式不正・ID/status不一致: `CODEX_TASK_METADATA_INVALID`。
- active pathのリンク置換: `CODEX_TASK_PATH_INVALID`。リンク自体がactiveの通常ファイルとして数えられない場合は `CODEX_TASK_ACTIVE_MISMATCH`。
- 古いspec_version/fingerprint: 既存の `TASK_SPEC_VERSION_MISMATCH` / `TASK_SOURCE_FINGERPRINT_MISMATCH`。
- scope配列欠落・型不正・空allowed: `TASK_SCOPE_METADATA_INVALID`。重複key・不正なflat構造は既存launcherと同様に拒否する。
- scope外: `TASK_PATH_NOT_ALLOWED`、禁止path: `TASK_PATH_FORBIDDEN`。
- path文法不正: `TASK_SCOPE_PATH_INVALID`、実体がrepo外: `TASK_SCOPE_PATH_OUTSIDE`、linkや既存親を解決不能: `TASK_SCOPE_PATH_UNRESOLVED`。
- Git取得失敗: `TASK_SCOPE_GIT_FAILED`、status不正: `GIT_STATUS_INVALID`、HEAD/diff不正: `TASK_SCOPE_GIT_INVALID`。未対応statusやconflictも拒否する。
- 読込不能やmapping不正も起動せず失敗する。errorを確認して対象TASKを修正し、正式gateから再実行する。

## 適用確認と境界

### 機械的scope guard

ACTIVE TASKの `allowed_paths` は必須の非空配列、`forbidden_paths` は必須配列（禁止指定がなければ `[]`）。値は既存のflat frontmatter parserで解釈する。角括弧の内側をカンマで分割し、各要素をtrimして空要素を除く。`[23]` は文字列 `23` の配列となり、YAMLの数値・真偽値への型変換は追加しない。引用符も従来どおり値の一部であり、YAMLの引用解除は行わない。

```yaml
allowed_paths: [scripts/example.mjs, tests/example/**]
forbidden_paths: [tests/example/private/**]
```

scope matcherは既存の `pathMatchesPattern` を唯一の実装とする。repository-relativeのexact path、`*`（slashを含まない0文字以上）、`**`（既存regexの `.*`）を維持し、他のregex特殊文字はliteralとして扱う。大小文字は区別する。`allowed/**` は `allowed` 自身には一致しない。Windowsではbackslashをslashへ変換し、それ以外のplatformでは従来どおりliteralとして扱う。forbiddenを必ず優先する。

matcherの文法と、repository内に限定するpath検査を分離する。traversal（separatorの混在を含む）、絶対path、drive-relative、UNC、NULを拒否する。起動前はglobのliteral directory prefixも解決し、変更pathは実体を含めて検査する。旧matcherの受理範囲を狭める独自glob文法や、全platformでのcase-insensitive化は行わない。

既存pathと親directoryの実体を順に解決し、repo外へ到達するsymlink/junctionを拒否する。存在しないfileも既存親を検査する。repo内link経由では表記pathと実体pathの両方に同じscope判定を適用する。dangling linkや読込不能も失敗する。

起動前にmetadata、scope定義、Git変更集合を検査し、違反なら非0終了・Codex spawn 0。起動時のscope配列とHEADを親processが保持する。終了後はstatusを再取得し、起動時HEAD→終了時HEADのNUL区切りname-status差分を合算して同じ判定へ渡す。実行中にTASKを変更・移動しても起動時scopeを使う。child exit 0でも終了後違反なら全体を非0にする。違反がなければ既存のchild終了値・起動失敗を維持する。終了後違反の診断には `postflight` とchild結果を含める。

検査対象はtracked/staged/unstaged/ordinary untracked、新規・削除・rename/copy両端、起動中commitによるHEAD間差分。renameがdelete + newとして見える場合も両pathを検査する。Git ignored filesystem changes、変更後に復元され最終status/HEAD差分に残らない操作、検査後の競合変更は保証対象外。watcherやOSレベルの書込み遮断ではない。

`spec:check`のACTIVE/completion経路も同じscope判定を使う。staged renameとdelete + new形式の正式完了を認識し、HEADにある移動元ACTIVE TASKのscopeを使う。初commit前に作成・完了したTASKは、自completedと新規anchorの組合せを既存経路として維持する。自TASKのcompleted pathと専用anchorはallowedへ正確に記録する必要があり、完了処理の自動許可や実行はしない。他TASKや既存anchorは今回TASKのallowlist外として拒否し、既存anchorの履歴保護も継続する。履歴として読むcompleted TASKへ新しい厳格scope検証を遡及適用しない。

### execution profile

profileの解決経路は、TASK → TASK launcher → 既存profile launcher → 正本JSON → Codexの起動引数。testsでは実際の既存launcherを通し、Codex processのspawn境界だけを置換して4 profileの引数一致と異常時のspawn 0を確認する。

機械的保証は起動時のTASK snapshotから選択したprofileと渡す引数の一致まで。実際のCLIの起動画面でmodel/reasoningを確認できるが、利用者がその値を入力する必要はない。モデルの利用可否はCodex自身が判定する。mockでの引数一致を、サービスへの接続成功や実行中Desktopセッションへの適用成功とは扱わない。

profileの更新時は、実際に起動したsessionのJSONLを確認する。CLIが返したsession IDに対応する記録を探し、`session_meta` のID・CLI version・cwdと、`turn_context` のcwd・`model`・`effort` を正本JSONおよび起動commandに照合する。保存先やfield名はCLI versionにより変わるため、実データを確認する。execution profile名がJSONLに直接記録されない場合は、起動commandのprofileとsession IDを証跡で結び付ける。

単一ACTIVE TASKのmetadataで全profileを試せない場合は、既存の `pnpm run codex:profile <profile> exec -- <検証prompt>` で各profileの実sessionを起動できる。検証promptはファイル変更なしの短い応答を要求する。TASKからの選択経路は引き続き `codex:task` で確認する。CLIの拒否、別modelへのfallback、必要fieldやJSONLの欠落はBLOCKEDとして記録し、設定値やmockの一致で実適用PASSを代用しない。

起動ごとにTASKを再読する。明示指定、または自動選択の判定入力を変える場合はTASKを変更し、終了後に再起動する。起動時のprofileとscopeを途中で変更しない。既に動いているセッション、対話中の設定操作、後からのTASK編集を監視する機構はない。

execution profileは能力選択のみ。`review`を含め、filesystem・command・sandbox・approval・network・commit/push権限を設定しない。既存の権限管理とTASK制約が引き続き適用される。過去のcompleted TASKへmetadataを一括追加せず、TASKの完了・anchor生成は既存手順を守る。
