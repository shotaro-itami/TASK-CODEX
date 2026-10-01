import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEPRECATIONS_PATH,
  EXPECTED_SPEC_VERSION,
  EXPECTED_SPREADSHEET_ID,
  GENERATED_SPEC_FILES,
  IMPLEMENTATION_TRACEABILITY_PATH,
  MANIFEST_PATH,
  REPO_ROOT,
  SNAPSHOT_PATH,
} from "./config.mjs";
import { SpecError } from "./errors.mjs";
import {
  assertActiveTaskCurrent,
  assertTaskScope,
  findCompletionTask,
  gitChangedPaths,
  parseGitStatus,
  readGitStatus,
  validateGovernance,
} from "./governance.mjs";
import { verifyCompletedTaskAnchors } from "./task-anchors.mjs";
import { assertGeneratedFileSet } from "./generator.mjs";
import {
  hashGeneratedFiles,
  listMarkdownFiles,
  parseTaskFrontmatter,
  readJson,
  sha256,
  sourceFingerprint,
} from "./lib.mjs";
import { getSpecCatalog, validateCanonicalSnapshot } from "./schema.mjs";

const errors = [];

function report(code, target, expected, actual, reference = "TASK-SPEC-001") {
  errors.push({ code, target, expected, actual, reference });
}

async function capture(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SpecError) report(error.code, error.target, error.expected, error.actual, error.reference);
    else report("SPEC_UNEXPECTED_ERROR", "spec:check", "successful validation", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function checkLinks(relativePath, content) {
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const href = match[1];
    if (/^(https?:|#)/u.test(href)) continue;
    const target = path.resolve(REPO_ROOT, path.dirname(relativePath), href.split("#")[0]);
    try {
      await access(target);
    } catch {
      report("SPEC_LINK_BROKEN", relativePath, "existing local target", href, "DET-082");
    }
  }
}

let manifest;
let snapshot;
let catalog;
await capture(async () => {
  manifest = await readJson(process.env.SPEC_MANIFEST_PATH ?? MANIFEST_PATH);
  snapshot = await readJson(SNAPSHOT_PATH);
  validateCanonicalSnapshot(snapshot);
  catalog = getSpecCatalog(snapshot);
  if (manifest.spec_version !== EXPECTED_SPEC_VERSION) report("SPEC_VERSION_MISMATCH", MANIFEST_PATH, EXPECTED_SPEC_VERSION, manifest.spec_version, "DET-074,DET-086");
  if (manifest.source_spreadsheet_id !== EXPECTED_SPREADSHEET_ID) report("SPEC_SOURCE_MISMATCH", MANIFEST_PATH, EXPECTED_SPREADSHEET_ID, manifest.source_spreadsheet_id, "BAS-042");
  const fingerprint = sourceFingerprint(snapshot);
  if (manifest.source_fingerprint !== fingerprint) report("SPEC_STALE", SNAPSHOT_PATH, manifest.source_fingerprint, fingerprint, "DET-086");
  if (!/^sha256:[0-9a-f]{64}$/u.test(manifest.source_fingerprint ?? "")) report("SPEC_FINGERPRINT_INVALID", MANIFEST_PATH, "sha256:<64 lowercase hex>", manifest.source_fingerprint, "DET-086");
  try { assertGeneratedFileSet(manifest.generated_files); } catch (error) { report(error.code, MANIFEST_PATH, error.expected, error.actual, "DET-083,DET-086"); }
  const currentGeneratedHash = await hashGeneratedFiles(GENERATED_SPEC_FILES);
  if (manifest.generated_files_hash !== currentGeneratedHash) report("SPEC_GENERATED_FILES_CHANGED", "generated specification files", manifest.generated_files_hash, currentGeneratedHash, "DET-086");
});

const activeTaskFiles = await listMarkdownFiles("tasks/active");
const completedTaskFiles = await listMarkdownFiles("tasks/completed");
if (activeTaskFiles.length > 1) report("TASK_ACTIVE_COUNT_INVALID", "tasks/active", "0 or 1 markdown task", String(activeTaskFiles.length), "BAS-037,DET-075");

const parsedTasks = [];
for (const taskFile of [...activeTaskFiles, ...completedTaskFiles]) {
  await capture(async () => {
    const content = await readFile(path.join(REPO_ROOT, taskFile), "utf8");
    const active = taskFile.startsWith("tasks/active/");
    const task = parseTaskFrontmatter(content, { strict: active });
    if (!task) throw new SpecError("TASK_METADATA_MISSING", taskFile, "YAML frontmatter", "not found", "DET-075");
    parsedTasks.push({ taskFile, task });
    if (active) assertTaskScope(task);
    const expectedStatus = active ? "ACTIVE" : "COMPLETED";
    if (task.status !== expectedStatus) report("TASK_STATUS_MISMATCH", taskFile, expectedStatus, task.status, "DET-075");
    if (active && manifest) {
      try { assertActiveTaskCurrent(task, manifest); } catch (error) { report(error.code, taskFile, error.expected, error.actual, "BAS-042,DET-074,DET-086"); }
    }
    if (!active && !/^\d{4}\.\d{2}\.\d{2}-v\d+$/u.test(task.spec_version ?? "")) report("TASK_SPEC_VERSION_INVALID", taskFile, "historical spec_version format", task.spec_version, "DET-075,DET-086");
    if (!active && !/^sha256:[0-9a-f]{64}$/u.test(task.source_fingerprint ?? "")) report("TASK_SOURCE_FINGERPRINT_INVALID", taskFile, "historical sha256 fingerprint format", task.source_fingerprint, "DET-075,DET-086");
    const sourceIds = catalog ? new Set([...catalog.reqIds, ...catalog.basIds, ...catalog.detIds, ...catalog.chkIds]) : new Set();
    if (active) {
      const missing = (task.related_specs ?? []).filter((id) => !sourceIds.has(id));
      if (missing.length > 0) report("TASK_RELATED_SPEC_MISSING", taskFile, "IDs present in canonical source", missing.join(","), "DET-074,DET-082");
    }
    await checkLinks(taskFile, content);
  });
}

if (!completedTaskFiles.some((taskFile) => taskFile.endsWith("TASK-001.md"))) report("TASK_001_MISSING", "tasks/completed", "TASK-001.md", "not found", "DET-075");
const gitStatusEntries = await capture(() => parseGitStatus(readGitStatus({ repoRoot: REPO_ROOT }))) ?? [];
await capture(() => verifyCompletedTaskAnchors({ repoRoot: REPO_ROOT, gitEntries: gitStatusEntries }));

await capture(async () => {
  const index = await readFile(path.join(REPO_ROOT, "docs/product-specs/index.md"), "utf8");
  const developmentRules = await readFile(path.join(REPO_ROOT, "docs/product-specs/development-rules.md"), "utf8");
  const traceability = await readJson("docs/traceability.yaml");
  const deprecations = await readJson(DEPRECATIONS_PATH);
  const implementation = await readJson(IMPLEMENTATION_TRACEABILITY_PATH);
  const sourceIds = new Set(catalog ? [...catalog.reqIds, ...catalog.basIds, ...catalog.detIds, ...catalog.chkIds] : []);
  for (const id of traceability.all_spec_ids ?? []) if (!sourceIds.has(id)) report("TRACEABILITY_UNKNOWN_ID", "docs/traceability.yaml", "ID present in canonical source", id, "DET-082,DET-083");
  for (const requirement of traceability.requirements ?? traceability.source_relationships?.requirements ?? []) {
    for (const id of [requirement.req_id, ...(requirement.bas_ids ?? []), ...(requirement.det_ids ?? []), ...(requirement.chk_ids ?? [])]) {
      if (!sourceIds.has(id)) report("TRACEABILITY_UNKNOWN_ID", requirement.req_id, "ID present in canonical source", id, "DET-082,DET-083");
    }
    if (requirement.product_spec) {
      try { await access(path.join(REPO_ROOT, requirement.product_spec)); } catch { report("TRACEABILITY_LINK_BROKEN", requirement.req_id, "existing product_spec", requirement.product_spec, "DET-082"); }
    }
  }
  const recordById = new Map([
    ...(catalog?.reqRows ?? []),
    ...(catalog?.basRows ?? []),
    ...(catalog?.detRows ?? []),
    ...(catalog?.chkRows ?? []),
  ].map((row) => [row.ID ?? row["論点ID"], row.values]));
  for (const mapping of implementation.mappings ?? []) {
    if (!["PARTIAL", "VERIFIED", "STALE"].includes(mapping.status)) report("IMPLEMENTATION_MAPPING_STATUS_INVALID", IMPLEMENTATION_TRACEABILITY_PATH, "PARTIAL|VERIFIED|STALE", mapping.status);
    for (const id of mapping.spec_ids ?? []) {
      if (!sourceIds.has(id)) report("IMPLEMENTATION_MAPPING_UNKNOWN_ID", IMPLEMENTATION_TRACEABILITY_PATH, "ID present in canonical source", id);
      if (mapping.status === "VERIFIED") {
        const actual = recordById.has(id) ? `sha256:${sha256(JSON.stringify(recordById.get(id)))}` : "missing";
        const expected = mapping.verified_spec_row_hashes?.[id];
        if (!expected || expected !== actual) report("IMPLEMENTATION_MAPPING_STALE", id, expected ?? "verified row hash", actual);
      }
    }
    for (const artifactPath of [...(mapping.code ?? []), ...(mapping.tests ?? [])]) {
      try { await access(path.join(REPO_ROOT, artifactPath)); } catch { report("IMPLEMENTATION_MAPPING_PATH_BROKEN", artifactPath, "existing code/test path", "missing"); }
    }
  }
  for (const pattern of deprecations.patterns ?? []) {
    const expression = new RegExp(pattern.pattern, pattern.flags ?? "u");
    if (expression.test(index) || expression.test(developmentRules)) report("SPEC_DEPRECATED_PATTERN", pattern.id ?? pattern.pattern, "pattern absent", "found", "DET-086");
  }
  await checkLinks("docs/product-specs/index.md", index);
  await checkLinks("docs/product-specs/development-rules.md", developmentRules);
});

await capture(async () => {
  const entries = gitStatusEntries;
  const changedPaths = gitChangedPaths(entries);
  const activeTask = parsedTasks.find(({ taskFile }) => taskFile.startsWith("tasks/active/"))?.task ?? null;
  const completionTask = activeTask ? null : await findCompletionTask(entries, REPO_ROOT);
  validateGovernance({ changedPaths, activeTask, completionTask, specStateValid: errors.length === 0 });
});

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error.code);
    console.error(`target: ${error.target}`);
    console.error(`expected: ${error.expected}`);
    console.error(`actual: ${error.actual}`);
    console.error(`reference: ${error.reference}`);
    console.error("");
  }
  process.exitCode = 1;
} else {
  console.log("SPEC_CHECK_OK");
  console.log(`spec_version: ${manifest.spec_version}`);
  console.log(`source_fingerprint: ${manifest.source_fingerprint}`);
  console.log(`generated_files_hash: ${manifest.generated_files_hash}`);
  console.log(`active_tasks: ${activeTaskFiles.length}`);
}
