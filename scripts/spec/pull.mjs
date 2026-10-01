import { pathToFileURL } from "node:url";
import { fetchGoogleSheetRaw } from "./google-sheets-source.mjs";
import { buildSpecPullSummary, canonicalizeRawSource } from "./schema.mjs";
import { printSpecError } from "./errors.mjs";

export async function pullAndValidate(options = {}) {
  const raw = await fetchGoogleSheetRaw(options);
  const snapshot = canonicalizeRawSource(raw);
  const summary = buildSpecPullSummary(snapshot);
  return { raw, snapshot, summary };
}

export function formatPullSummary(summary) {
  return [
    ...summary.sheets.map((sheet) => `tab ${sheet.name}: rows=${sheet.row_count}`),
    ...summary.id_series.map((series) => (
      `id_series ${series.prefix}: min=${series.min_id} max=${series.max_id} count=${series.count} duplicates=${series.duplicate_count} missing=${series.missing_ids.length}`
    )),
  ];
}

async function main() {
  const { snapshot, summary } = await pullAndValidate();
  console.log("SPEC_PULL_OK");
  console.log(`source_spreadsheet_id: ${snapshot.source_spreadsheet_id}`);
  console.log(`sheets: ${snapshot.sheets.length}`);
  for (const line of formatPullSummary(summary)) console.log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    printSpecError(error);
    process.exitCode = 1;
  });
}
