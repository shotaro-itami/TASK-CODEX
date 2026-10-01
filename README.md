# TASK-CODEX — 完了TASKの機能一覧

`study-app`で完了したTASK-CODEX-001〜005について、提供する機能と処理内容をまとめた資料です。Codex CLIのprofile起動、TASK連携、scope guard、profile更新、自動profile選択をタスク単位で確認できます。

このリポジトリには機能説明、完了TASK文書、TASK-CODEX-001〜005の実装コード・設定・テストを掲載しています。[study-app](https://github.com/shotaro-itami/study-app)の参照commitから成果物と必要な共通コードを抽出し、原本を変更せず保持しています。

## 掲載している実装

| 内容 | ファイル |
| --- | --- |
| profileの正本mapping | [.codex/execution-profiles.json](.codex/execution-profiles.json) |
| profile launcher | [scripts/codex-profile.mjs](scripts/codex-profile.mjs) |
| TASK launcher・起動前後のscope検査 | [scripts/codex-task.mjs](scripts/codex-task.mjs) |
| 自動profile selector | [scripts/codex-profile-selection.mjs](scripts/codex-profile-selection.mjs) |
| 共通parser・scope guard・仕様検査 | [scripts/spec/](scripts/spec/) |
| profile・TASK・selectorテスト | [tests/](tests/)の`codex-*.test.mjs` |
| scope・仕様governanceの関連回帰 | [tests/spec/](tests/spec/) |
| TASK起動契約・運用説明 | [docs/codex-task.md](docs/codex-task.md) |
| 完了時の履歴anchor | [tasks/anchors/](tasks/anchors/) |

TASK-CODEX-004はmappingの更新、TASK-CODEX-005はselectorとTASK launcherの統合です。1つのファイルに複数TASKの成果が含まれる場合は、参照commit時点の最終版を掲載しています。

### 関連テストの実行

Node.js v24.19.0で確認したコードです。テストはNode.js標準機能を使うため、掲載範囲の検証にアプリの依存インストールは必要ありません。Gitを利用できる環境で、リポジトリのルートから実行します。

```powershell
node --test tests/codex-profile.test.mjs tests/codex-task.test.mjs tests/codex-profile-selection.test.mjs tests/spec/task-scope.test.mjs tests/spec/sync-governance.test.mjs
```

### 原本との関係・実行範囲

`package.json`、`AGENTS.md`、仕様manifestと運用文書も原本を保持しています。そこに記載されているアプリ全体の`verify`、教材pipeline、DB、仕様同期に必要な製品コード・仕様データ一式は、この抽出リポジトリには含めていません。アプリ全体の検証と仕様同期はstudy-appで行います。

profile launcherは`pnpm run codex:profile <profile>`で実行できます。実際の起動にはCodex CLIと対象modelを利用できる環境が必要です。TASK launcherは`pnpm run codex:task <TASK-ID>`で、対象repositoryのACTIVE TASK・manifest・scopeを検査して起動します。ここに掲載したTASK文書5件はCOMPLETEDのため、そのまま実行用ACTIVE TASKにはしません。

`scripts/spec/`にはparserやscope検査の依存コード、および関連回帰テストに必要な仕様同期の共通コードを含めています。`tasks/active/.gitkeep`は空ディレクトリをGitに保持するための配置ファイルです。TASK-CODEX-006の実装は含めていません。

## 集計対象

- 確認日：2026-10-01（日本時間）
- 対象：`status: COMPLETED`のTASK-CODEX-001〜005 **5件**
- 参照した実装リポジトリのcommit：[`63851c2`](https://github.com/shotaro-itami/study-app/tree/63851c20e2b2a3356d40d015e5c3ecd593b2c630)
- TASK-CODEX-006はACTIVEのため、今回の完了一覧には含めていません。

各TASKのリンクはこのリポジトリに同梱した完了文書へ向いています。同梱文書は参照commitの原本と同じbytesを保持しています。「完了」は当該TASKの実装範囲の完了を表します。学習アプリ全体の完成や、実AWS教材の全件検証完了を意味するものではありません。

## Codexの起動・実行管理：5件

### TASK-CODEX-001：execution profile launcher

**機能：抽象profileを指定してCodex CLIを起動できます。**

`light / standard / deep / review`を、唯一の正本である`.codex/execution-profiles.json`のmodel・reasoning effortへ変換します。mappingや引数を検証し、model・effortを後から上書きする引数を拒否します。

入口は`pnpm run codex:profile <profile>`です。profileはmodel・effortを選択し、filesystemなどの権限は変更しません。

[完了TASKを読む](tasks/completed/TASK-CODEX-001.md)

### TASK-CODEX-002：TASKからexecution profileを引き継ぐ起動

**機能：TASK IDだけを指定して、そのTASKのprofileで起動できます。**

ACTIVE TASKのfrontmatterを厳格に読み、TASK ID・status・単一ACTIVE条件・仕様version・fingerprintを検査して既存profile launcherへ渡します。不正metadataや仕様不整合ではCodexを起動しません。

入口は`pnpm run codex:task <TASK-ID>`です。TASKごとにmodel名・effortを手入力する作業を減らします。profile省略時の自動選択は後述のTASK-CODEX-005で追加されています。

[完了TASKを読む](tasks/completed/TASK-CODEX-002.md)

### TASK-CODEX-003：TASK単位のscope guard

**機能：TASKの許可範囲を外れたGit変更を検出して、起動・成功判定を拒否します。**

`allowed_paths / forbidden_paths`を基準に、起動前と終了後のstaged・unstaged・untracked変更、rename/copyの両端、実行中commitのHEAD間差分を検査します。許可と禁止が重なる場合は禁止を優先し、起動時のscopeを終了時にも使います。

TASK launcherと`spec:check`に統合されています。Git ignoredの変更や、一度変更して元へ戻した操作は保証対象外です。OSによる書込み遮断ではありません。

[完了TASKを読む](tasks/completed/TASK-CODEX-003.md)

### TASK-CODEX-004：execution profileの更新と実適用確認

**機能：4つのprofileのmodel・effort対応を更新し、実sessionへの適用を確認しました。**

既存launcherとscope guardを維持したまま、単一mapping、関連テスト、運用説明を更新しました。4 profileおよびTASK起動について、実sessionのJSONLに記録されたmodel・effortを照合しています。

実model名・effortの現在値は実装リポジトリのmappingを参照します。READMEに対応表を複製せず、更新先を一元化します。

[完了TASKを読む](tasks/completed/TASK-CODEX-004.md)

### TASK-CODEX-005：TASK内容からprofileを自動選択

**機能：profileを完全省略したTASKでは、構造化された作業内容からprofileを決定します。**

GoalのIntent、Acceptance Criteriaのchange/risk marker、change_targets、scopeを検査し、既存launcherへ選択結果を渡します。有効な明示指定は最優先で維持します。空値・未知値などの不正指定は拒否し、自動選択へfallbackしません。

選択根拠が不足・矛盾している場合は起動を拒否します。selection source・reason code・reasonを出力し、起動ごとに選択結果とscopeを固定します。

[完了TASKを読む](tasks/completed/TASK-CODEX-005.md)

### 起動時の処理の流れ

```text
TASK ID
  → ACTIVE TASK・仕様鮮度・scopeの検査
  → 有効な明示profile、または完全省略時の自動選択
  → 唯一のmappingからmodel・effortを取得
  → Codex CLIを起動
  → 終了後のGit変更を起動時scopeで検査
  → child結果とscope検査結果から終了コードを決定
```

## 検証・詳細資料

study-appの`pnpm run verify`は、lint、typecheck、Node tests、architecture、toolchain、Python tests、DB、content、specの検査をまとめたread-only品質ゲートです。`pnpm run maintain`は別の保守ゲートです。

各TASKの受入条件・検証結果・保証範囲は、上記の完了TASKリンクを参照してください。このREADMEは機能概要であり、承認仕様、TASK、profile mappingを置き換えるものではありません。
