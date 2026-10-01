import { SHEET_SCHEMAS, EXPECTED_SPEC_VERSION, EXPECTED_SPREADSHEET_ID } from "./config.mjs";
import { SpecError, assertSpec } from "./errors.mjs";

export function normalizeCell(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}
export function normalizeRows(inputRows) {
  const rows = (inputRows ?? []).map((row) => row.map(normalizeCell));
  while (rows.length > 0 && rows.at(-1).every((cell) => cell === "")) rows.pop();
  let width = 0;
  for (const row of rows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (row[index] !== "") {
        width = Math.max(width, index + 1);
        break;
      }
    }
  }
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellAddress(sheetName, rowIndex, columnIndex) {
  return `${sheetName}!${columnName(columnIndex)}${rowIndex + 1}`;
}

function valueFromRawCell(cell) {
  if (cell == null || typeof cell !== "object" || Array.isArray(cell)) return normalizeCell(cell);
  return normalizeCell(cell.value);
}

function formulaFromRawCell(cell) {
  return cell && typeof cell === "object" && !Array.isArray(cell) ? normalizeCell(cell.formula) : "";
}

function validateHeaders(sheet, schema, rows) {
  assertSpec(rows.length > 0, "SPEC_SOURCE_HEADER_MISSING", sheet.name, schema.headers.join(" | "), "no rows");
  const actualHeaders = Array.from({ length: schema.headers.length }, (_, index) => valueFromRawCell(rows[0]?.[index]));
  const duplicates = actualHeaders.filter((header, index) => header && actualHeaders.indexOf(header) !== index);
  assertSpec(duplicates.length === 0, "SPEC_SOURCE_HEADER_DUPLICATE", sheet.name, "unique headers", [...new Set(duplicates)].join(","));
  assertSpec(
    JSON.stringify(actualHeaders) === JSON.stringify(schema.headers),
    "SPEC_SOURCE_HEADER_CHANGED",
    `${sheet.name}!1:1`,
    schema.headers.join(" | "),
    actualHeaders.join(" | "),
  );
}

function validateRawSheet(sheet, schema) {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  validateHeaders(sheet, schema, rows);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex];
      const value = valueFromRawCell(cell);
      const formula = formulaFromRawCell(cell);
      const address = cellAddress(sheet.name, rowIndex, columnIndex);
      assertSpec(!formula, "SPEC_SOURCE_FORMULA_FORBIDDEN", address, "literal value", formula);
      if (columnIndex >= schema.headers.length) {
        assertSpec(!value, "SPEC_SOURCE_EXTRA_CELL", address, `empty outside ${schema.headers.length} formal columns`, value);
      }
    }
  }

  const values = rows.map((row) => Array.from(
    { length: schema.headers.length },
    (_, index) => valueFromRawCell(Array.isArray(row) ? row[index] : undefined),
  ));
  return normalizeRows(values);
}

export function parseReferenceExpression(value, expectedPrefix) {
  const input = normalizeCell(value).trim();
  if (!input) return [];
  const tokens = input.split(/[,、]/u).map((token) => token.trim()).filter(Boolean);
  const result = [];
  let prefix = expectedPrefix ?? "";
  for (const token of tokens) {
    const range = token.match(/^([A-Z]+)-(\d{3})[〜～~](?:([A-Z]+)-)?(\d{3})$/u);
    if (range) {
      const startPrefix = range[1];
      const endPrefix = range[3] || startPrefix;
      assertSpec(startPrefix === endPrefix, "SPEC_REFERENCE_FORMAT_INVALID", input, `${expectedPrefix}-NNN range`, token);
      assertSpec(!expectedPrefix || startPrefix === expectedPrefix, "SPEC_REFERENCE_TYPE_INVALID", input, expectedPrefix, startPrefix);
      const start = Number(range[2]);
      const end = Number(range[4]);
      assertSpec(end >= start, "SPEC_REFERENCE_RANGE_INVALID", input, "ascending range", token);
      prefix = startPrefix;
      for (let number = start; number <= end; number += 1) result.push(`${prefix}-${String(number).padStart(3, "0")}`);
      continue;
    }
    const full = token.match(/^([A-Z]+)-(\d{3})$/u);
    if (full) {
      prefix = full[1];
      assertSpec(!expectedPrefix || prefix === expectedPrefix, "SPEC_REFERENCE_TYPE_INVALID", input, expectedPrefix, prefix);
      result.push(`${prefix}-${full[2]}`);
      continue;
    }
    const short = token.match(/^(\d{3})$/u);
    if (short && prefix) {
      assertSpec(!expectedPrefix || prefix === expectedPrefix, "SPEC_REFERENCE_TYPE_INVALID", input, expectedPrefix, prefix);
      result.push(`${prefix}-${short[1]}`);
      continue;
    }
    throw new SpecError("SPEC_REFERENCE_FORMAT_INVALID", input, `${expectedPrefix}-NNN[,NNN] or ${expectedPrefix}-NNN〜NNN`, token);
  }
  return [...new Set(result)];
}

export function recordsForSheet(snapshot, sheetName) {
  const sheet = snapshot.sheets.find((candidate) => candidate.name === sheetName);
  assertSpec(sheet, "SPEC_SOURCE_TAB_MISSING", sheetName, "required sheet", "missing");
  const [headers, ...rows] = sheet.values;
  return rows.map((row, index) => ({
    rowNumber: index + 2,
    values: row,
    ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])),
  }));
}

function parseSeriesId(id, expectedPrefix, target = expectedPrefix) {
  const match = String(id).match(/^([A-Z]+)-(\d{3})$/u);
  assertSpec(Boolean(match), "SPEC_ID_INVALID", target, `${expectedPrefix}-NNN`, String(id));
  assertSpec(match[1] === expectedPrefix, "SPEC_ID_PREFIX_MISMATCH", target, expectedPrefix, match[1]);
  const number = Number(match[2]);
  assertSpec(number >= 1, "SPEC_ID_INVALID", target, `${expectedPrefix}-001 or greater`, String(id));
  return number;
}

export function summarizeIdSeries(ids, expectedPrefix) {
  assertSpec(ids.length > 0, `SPEC_${expectedPrefix}_ID_EMPTY`, expectedPrefix, `${expectedPrefix}-001 or greater`, "empty series");
  const seen = new Set();
  const numbers = [];
  for (const id of ids) {
    const number = parseSeriesId(id, expectedPrefix, id);
    assertSpec(!seen.has(id), `SPEC_${expectedPrefix}_ID_DUPLICATE`, id, "unique ID", id);
    seen.add(id);
    numbers.push(number);
  }
  const maxNumber = Math.max(...numbers);
  const present = new Set(numbers);
  const missingIds = [];
  for (let number = 1; number <= maxNumber; number += 1) {
    if (!present.has(number)) missingIds.push(`${expectedPrefix}-${String(number).padStart(3, "0")}`);
  }
  assertSpec(
    missingIds.length === 0,
    `SPEC_${expectedPrefix}_ID_GAP`,
    expectedPrefix,
    `continuous range ${expectedPrefix}-001..${expectedPrefix}-${String(maxNumber).padStart(3, "0")}`,
    `missing ${missingIds.join(",")}`,
  );
  return {
    prefix: expectedPrefix,
    min_id: `${expectedPrefix}-001`,
    max_id: `${expectedPrefix}-${String(maxNumber).padStart(3, "0")}`,
    count: ids.length,
    duplicate_count: 0,
    missing_ids: [],
  };
}

export function validateCanonicalSnapshot(snapshot) {
  assertSpec(snapshot && typeof snapshot === "object", "SPEC_SOURCE_MALFORMED", "source", "object", typeof snapshot);
  assertSpec(snapshot.source_spreadsheet_id === EXPECTED_SPREADSHEET_ID, "SPEC_SOURCE_MISMATCH", "source_spreadsheet_id", EXPECTED_SPREADSHEET_ID, snapshot.source_spreadsheet_id);
  assertSpec(snapshot.spec_version === EXPECTED_SPEC_VERSION, "SPEC_VERSION_MISMATCH", "spec_version", EXPECTED_SPEC_VERSION, snapshot.spec_version);
  assertSpec(Array.isArray(snapshot.sheets), "SPEC_SOURCE_MALFORMED", "sheets", "array", typeof snapshot.sheets);
  const names = snapshot.sheets.map((sheet) => sheet.name);
  const expectedNames = SHEET_SCHEMAS.map((schema) => schema.name);
  for (const name of names) assertSpec(expectedNames.includes(name), "SPEC_SOURCE_TAB_UNKNOWN", name, expectedNames.join(","), name);
  for (const name of expectedNames) assertSpec(names.includes(name), "SPEC_SOURCE_TAB_MISSING", name, "required sheet", "missing");
  assertSpec(JSON.stringify(names) === JSON.stringify(expectedNames), "SPEC_SOURCE_TAB_ORDER", "sheets", expectedNames.join(","), names.join(","));

  const catalogs = { REQ: new Map(), BAS: new Map(), DET: new Map(), CHK: new Map() };
  for (const schema of SHEET_SCHEMAS) {
    const sheet = snapshot.sheets.find((candidate) => candidate.name === schema.name);
    const rows = normalizeRows(sheet.values);
    const headers = rows[0] ?? [];
    const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
    assertSpec(duplicates.length === 0, "SPEC_SOURCE_HEADER_DUPLICATE", schema.name, "unique headers", [...new Set(duplicates)].join(","));
    assertSpec(JSON.stringify(headers) === JSON.stringify(schema.headers), "SPEC_SOURCE_HEADER_CHANGED", `${schema.name}!1:1`, schema.headers.join(" | "), headers.join(" | "));
    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index];
      assertSpec(row.length <= schema.headers.length, "SPEC_SOURCE_EXTRA_CELL", `${schema.name}!${index + 1}`, `${schema.headers.length} columns`, String(row.length));
      const isEmpty = row.every((cell) => cell === "");
      assertSpec(!isEmpty, "SPEC_SOURCE_ROW_MALFORMED", `${schema.name}!${index + 1}`, "non-empty record", "empty row");
      const key = row[0] ?? "";
      assertSpec(Boolean(key), "SPEC_ID_MISSING", `${schema.name}!A${index + 1}`, schema.idKind ? `${schema.idKind}-NNN` : schema.keyHeader, "empty");
      if (schema.idKind) {
        parseSeriesId(key, schema.idKind, `${schema.name}!A${index + 1}`);
        assertSpec(!catalogs[schema.idKind].has(key), `SPEC_${schema.idKind}_ID_DUPLICATE`, `${schema.name}!A${index + 1}`, "unique ID", key);
        catalogs[schema.idKind].set(key, { row, rowNumber: index + 1 });
      }
    }
  }

  for (const [prefix, records] of Object.entries(catalogs)) summarizeIdSeries([...records.keys()], prefix);

  const assertReferences = (sourceId, value, targetKind, targetMap) => {
    const references = parseReferenceExpression(value, targetKind);
    for (const reference of references) {
      assertSpec(targetMap.has(reference), "SPEC_REFERENCE_MISSING", sourceId, `${targetKind} reference present in source`, reference);
    }
    return references;
  };
  for (const [id, record] of catalogs.BAS) assertReferences(id, record.row[4], "REQ", catalogs.REQ);
  for (const [id, record] of catalogs.DET) assertReferences(id, record.row[6], "BAS", catalogs.BAS);
  const checkRows = recordsForSheet(snapshot, "04_対応表_論点");
  for (const row of checkRows) {
    assertReferences(row["論点ID"], row["要件定義"], "REQ", catalogs.REQ);
    assertReferences(row["論点ID"], row["基本設計"], "BAS", catalogs.BAS);
    assertReferences(row["論点ID"], row["詳細設計"], "DET", catalogs.DET);
  }
  return catalogs;
}

export function buildSpecPullSummary(snapshot) {
  const catalogs = validateCanonicalSnapshot(snapshot);
  return {
    sheets: snapshot.sheets.map((sheet) => ({
      name: sheet.name,
      row_count: sheet.values.length,
    })),
    id_series: Object.entries(catalogs).map(([prefix, records]) => summarizeIdSeries([...records.keys()], prefix)),
  };
}

export function canonicalizeRawSource(rawSource) {
  assertSpec(rawSource && typeof rawSource === "object", "SPEC_SOURCE_MALFORMED", "raw source", "object", typeof rawSource);
  assertSpec(rawSource.source_spreadsheet_id === EXPECTED_SPREADSHEET_ID, "SPEC_SOURCE_MISMATCH", "source_spreadsheet_id", EXPECTED_SPREADSHEET_ID, rawSource.source_spreadsheet_id);
  const rawSheets = Array.isArray(rawSource.sheets) ? rawSource.sheets : [];
  const names = rawSheets.map((sheet) => sheet.name);
  const expectedNames = SHEET_SCHEMAS.map((schema) => schema.name);
  for (const name of names) assertSpec(expectedNames.includes(name), "SPEC_SOURCE_TAB_UNKNOWN", name, expectedNames.join(","), name);
  for (const name of expectedNames) assertSpec(names.includes(name), "SPEC_SOURCE_TAB_MISSING", name, "required sheet", "missing");
  assertSpec(JSON.stringify(names) === JSON.stringify(expectedNames), "SPEC_SOURCE_TAB_ORDER", "sheets", expectedNames.join(","), names.join(","));

  const snapshot = {
    format_version: 2,
    source_spreadsheet_id: rawSource.source_spreadsheet_id,
    source_title: normalizeCell(rawSource.source_title),
    spec_version: EXPECTED_SPEC_VERSION,
    normalization: {
      validation: "raw structure and semantics before canonicalization",
      cell_values: "formatted values converted to strings",
      line_endings: "LF",
      trailing_empty_rows: "removed",
      trailing_empty_columns: "removed",
      sheet_order: "formal schema order",
      cell_order: "row-major A1 order",
      encoding: "UTF-8",
      digest: "SHA-256 of JSON.stringify(sheets)",
    },
    sheets: SHEET_SCHEMAS.map((schema) => {
      const rawSheet = rawSheets.find((sheet) => sheet.name === schema.name);
      return {
        name: schema.name,
        sheet_id: rawSheet.sheet_id,
        values: validateRawSheet(rawSheet, schema),
      };
    }),
  };
  validateCanonicalSnapshot(snapshot);
  return snapshot;
}

export function getSpecCatalog(snapshot) {
  validateCanonicalSnapshot(snapshot);
  const reqRows = recordsForSheet(snapshot, "01_要件定義");
  const basRows = recordsForSheet(snapshot, "02_基本設計");
  const detRows = recordsForSheet(snapshot, "03_詳細設計");
  const chkRows = recordsForSheet(snapshot, "04_対応表_論点");
  return {
    reqRows,
    basRows,
    detRows,
    chkRows,
    reqIds: reqRows.map((row) => row.ID),
    basIds: basRows.map((row) => row.ID),
    detIds: detRows.map((row) => row.ID),
    chkIds: chkRows.map((row) => row["論点ID"]),
  };
}
