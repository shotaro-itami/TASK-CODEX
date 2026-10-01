import { SHEET_SCHEMAS, EXPECTED_SPREADSHEET_ID } from "../../scripts/spec/config.mjs";
import { canonicalizeRawSource } from "../../scripts/spec/schema.mjs";

export function cell(value = "", formula = "") {
  return { value, formula };
}
function row(values) {
  return values.map((value) => cell(value));
}

export function validRawSource() {
  const data = {
    "00_全体像": [SHEET_SCHEMAS[0].headers, ["目的", "学習を支援する", "確定", "fixture"]],
    "01_要件定義": [SHEET_SCHEMAS[1].headers, ["REQ-001", "fixture", "要件", "理由", "Must", "確定", "BAS-001"]],
    "02_基本設計": [SHEET_SCHEMAS[2].headers, ["BAS-001", "fixture", "設計", "機能", "REQ-001", "判断", "確定"]],
    "03_詳細設計": [SHEET_SCHEMAS[3].headers, ["DET-001", "fixture", "詳細", "入力", "処理", "出力", "BAS-001", "確定"]],
    "04_対応表_論点": [SHEET_SCHEMAS[4].headers, ["CHK-001", "論点", "REQ-001", "BAS-001", "DET-001", "整合", "対応"]],
  };
  return {
    format_version: 1,
    source_spreadsheet_id: EXPECTED_SPREADSHEET_ID,
    source_title: "fixture",
    sheets: SHEET_SCHEMAS.map((schema, index) => ({
      name: schema.name,
      sheet_id: index + 1,
      rows: data[schema.name].map(row),
    })),
  };
}

export function validSnapshot() {
  return canonicalizeRawSource(validRawSource());
}

export function clone(value) {
  return structuredClone(value);
}

export async function expectSpecError(assert, expectedCode, work) {
  await assert.rejects(work, (error) => error?.code === expectedCode);
}
