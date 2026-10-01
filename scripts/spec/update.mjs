import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEPRECATIONS_PATH, SNAPSHOT_PATH } from "./config.mjs";
import { printSpecError } from "./errors.mjs";
import { synchronizeSnapshot } from "./generator.mjs";
import { readJson } from "./lib.mjs";
import { pullAndValidate } from "./pull.mjs";
import { canonicalizeRawSource, validateCanonicalSnapshot } from "./schema.mjs";
import { assertNoUndeprecatedRemovals, semanticDiff, summarizeSemanticDiff } from "./semantic-diff.mjs";

export async function updateValidatedSnapshot(nextSnapshot, { repoRoot, generatedAt, beforePromote } = {}) {
  validateCanonicalSnapshot(nextSnapshot);
  const previousSnapshot = await readJson(SNAPSHOT_PATH, repoRoot);
  const deprecations = await readJson(DEPRECATIONS_PATH, repoRoot);
  const diff = semanticDiff(previousSnapshot, nextSnapshot);
  assertNoUndeprecatedRemovals(diff, deprecations);
  const sync = await synchronizeSnapshot(nextSnapshot, { repoRoot, writeSnapshot: true, generatedAt, beforePromote });
  return { ...sync, diff, summary: summarizeSemanticDiff(diff) };
}

export async function updateSpecifications({ rawSource, fetchOptions, repoRoot, generatedAt, beforePromote } = {}) {
  const nextSnapshot = rawSource
    ? canonicalizeRawSource(rawSource)
    : (await pullAndValidate(fetchOptions)).snapshot;
  return updateValidatedSnapshot(nextSnapshot, { repoRoot, generatedAt, beforePromote });
}

async function main() {
  const result = await updateSpecifications();
  execFileSync(process.execPath, [path.join(import.meta.dirname, "check.mjs")], { stdio: "inherit" });
  console.log(result.changed ? "SPEC_UPDATE_OK" : "SPEC_UPDATE_NO_OP");
  console.log(`semantic_diff: ${JSON.stringify(result.summary)}`);
  for (const sheet of result.diff.sheets) {
    for (const record of sheet.records.filter((candidate) => candidate.status !== "UNCHANGED")) {
      console.log(`${record.status}: ${sheet.name}:${record.key}`);
    }
  }
  console.log(`source_fingerprint: ${result.fingerprint}`);
  console.log(`generated_files_hash: ${result.generatedFilesHash}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    printSpecError(error);
    process.exitCode = 1;
  });
}
