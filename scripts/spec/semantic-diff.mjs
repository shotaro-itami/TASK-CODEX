import { createHash } from "node:crypto";
import { SHEET_SCHEMAS } from "./config.mjs";
import { SpecError } from "./errors.mjs";
import { normalizeCell, recordsForSheet, validateCanonicalSnapshot } from "./schema.mjs";

function hashRecord(values) {
  return `sha256:${createHash("sha256").update(JSON.stringify(values.map(normalizeCell)), "utf8").digest("hex")}`;
}
export function semanticDiff(previousSnapshot, nextSnapshot) {
  validateCanonicalSnapshot(previousSnapshot);
  validateCanonicalSnapshot(nextSnapshot);
  const sheets = [];
  for (const schema of SHEET_SCHEMAS) {
    const before = new Map(recordsForSheet(previousSnapshot, schema.name).map((record) => [record[schema.keyHeader], record.values]));
    const after = new Map(recordsForSheet(nextSnapshot, schema.name).map((record) => [record[schema.keyHeader], record.values]));
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
    const records = keys.map((key) => {
      const beforeValues = before.get(key);
      const afterValues = after.get(key);
      const status = !beforeValues ? "ADDED" : !afterValues ? "REMOVED" : JSON.stringify(beforeValues) === JSON.stringify(afterValues) ? "UNCHANGED" : "MODIFIED";
      return {
        key,
        status,
        before_hash: beforeValues ? hashRecord(beforeValues) : null,
        after_hash: afterValues ? hashRecord(afterValues) : null,
      };
    });
    sheets.push({ name: schema.name, records });
  }
  return { sheets };
}

export function assertNoUndeprecatedRemovals(diff, deprecations = {}) {
  const allowed = new Set(deprecations.removed_ids ?? deprecations.deprecated_ids ?? []);
  for (const sheet of diff.sheets) {
    if (!/^(01_|02_|03_|04_)/u.test(sheet.name)) continue;
    for (const record of sheet.records) {
      if (record.status === "REMOVED" && !allowed.has(record.key)) {
        throw new SpecError("SPEC_ID_REMOVED", `${sheet.name}:${record.key}`, "explicit ID deprecation", "removed without deprecation");
      }
    }
  }
}

export function summarizeSemanticDiff(diff) {
  const summary = { ADDED: 0, MODIFIED: 0, REMOVED: 0, UNCHANGED: 0 };
  for (const sheet of diff.sheets) for (const record of sheet.records) summary[record.status] += 1;
  return summary;
}
