import { pathToFileURL } from "node:url";
import { printSpecError } from "./errors.mjs";
import { formatPullSummary, pullAndValidate } from "./pull.mjs";
import { updateValidatedSnapshot } from "./update.mjs";

export async function syncFromLiveSource({
  fetchOptions,
  repoRoot,
  generatedAt,
  beforePromote,
  pull = pullAndValidate,
} = {}) {
  const live = await pull(fetchOptions);
  const result = await updateValidatedSnapshot(live.snapshot, { repoRoot, generatedAt, beforePromote });
  return { ...result, pullSummary: live.summary };
}

async function main() {
  const result = await syncFromLiveSource();
  console.log(result.changed ? "SPEC_SYNC_OK" : "SPEC_SYNC_NO_OP");
  for (const line of formatPullSummary(result.pullSummary)) console.log(line);
  console.log(`semantic_diff: ${JSON.stringify(result.summary)}`);
  console.log(`source_fingerprint: ${result.fingerprint}`);
  console.log(`generated_files_hash: ${result.generatedFilesHash}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    printSpecError(error);
    process.exitCode = 1;
  });
}
