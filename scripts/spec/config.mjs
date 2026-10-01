import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export const EXPECTED_SPREADSHEET_ID = "1R3VloB7XYOfHGZUGHHCCTcMXgvTUOxD9eHECfhg4vQ4";
export const EXPECTED_SPEC_VERSION = "2026.09.01-v1";
export const SNAPSHOT_PATH = "docs/product-specs/source-snapshot.json";
export const MANIFEST_PATH = "docs/spec-manifest.yaml";
export const DEPRECATIONS_PATH = "docs/spec-deprecations.yaml";
export const IMPLEMENTATION_TRACEABILITY_PATH = "scripts/spec/implementation-traceability.json";

export const SHEET_SCHEMAS = [
  { name: "00_全体像", keyHeader: "区分", idKind: null, headers: ["区分", "内容", "確定度", "補足"] },
  { name: "01_要件定義", keyHeader: "ID", idKind: "REQ", headers: ["ID", "分類", "要件", "目的・理由", "優先度", "状態", "基本設計への接続"] },
  { name: "02_基本設計", keyHeader: "ID", idKind: "BAS", headers: ["ID", "領域", "基本設計", "主な画面/機能", "関連要件", "設計判断", "状態"] },
  { name: "03_詳細設計", keyHeader: "ID", idKind: "DET", headers: ["ID", "対象", "詳細仕様", "入力", "処理", "出力/保存", "関連基本設計", "状態"] },
  { name: "04_対応表_論点", keyHeader: "論点ID", idKind: "CHK", headers: ["論点ID", "論点", "要件定義", "基本設計", "詳細設計", "判定", "対応"] },
];

export const GENERATED_SPEC_FILES = [
  "docs/product-specs/index.md",
  "docs/product-specs/development-rules.md",
  "docs/product-specs/content-management.md",
  "docs/product-specs/content-pipeline.md",
  "docs/traceability.yaml",
];

export const SPEC_SYNC_OWNED_FILES = [
  SNAPSHOT_PATH,
  ...GENERATED_SPEC_FILES,
  MANIFEST_PATH,
];
