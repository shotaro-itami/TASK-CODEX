import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GENERATED_SPEC_FILES, MANIFEST_PATH, SNAPSHOT_PATH, SPEC_SYNC_OWNED_FILES } from "../../scripts/spec/config.mjs";
import { assertGeneratedFileSet, renderGeneratedFiles, synchronizeSnapshot } from "../../scripts/spec/generator.mjs";
import {
  assertActiveTaskCurrent,
  parseGitStatus,
  pathDecision,
  readGitStatus,
  validateGovernance,
} from "../../scripts/spec/governance.mjs";
import { hashGeneratedFiles, readJson } from "../../scripts/spec/lib.mjs";
import { syncFromLiveSource } from "../../scripts/spec/sync.mjs";
import { updateSpecifications } from "../../scripts/spec/update.mjs";
import { clone, validRawSource, validSnapshot } from "./fixtures.mjs";

async function temporaryRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "study-app-spec-sync-"));
  await mkdir(path.join(root, "docs", "product-specs"), { recursive: true });
  await writeFile(path.join(root, SNAPSHOT_PATH), `${JSON.stringify(validSnapshot(), null, 2)}\n`, "utf8");
  await writeFile(path.join(root, "docs", "spec-deprecations.yaml"), '{"patterns":[],"removed_ids":[]}\n', "utf8");
  return root;
}

async function readOwnedFiles(root) {
  return Object.fromEntries(await Promise.all(SPEC_SYNC_OWNED_FILES.map(async (relativePath) => [
    relativePath,
    await readFile(path.join(root, relativePath), "utf8"),
  ])));
}

test("spec:sync starts from live pull and writes its validated snapshot", async () => {
  const root = await temporaryRepo();
  let pullCalls = 0;
  const liveSnapshot = validSnapshot();
  liveSnapshot.sheets.find((sheet) => sheet.name === "01_要件定義").values[1][2] = "live requirement";
  try {
    const result = await syncFromLiveSource({
      repoRoot: root,
      pull: async () => {
        pullCalls += 1;
        return { snapshot: liveSnapshot, summary: { source: "live" } };
      },
    });
    assert.equal(pullCalls, 1);
    assert.equal(result.changed, true);
    assert.deepEqual(await readJson(SNAPSHOT_PATH, root), liveSnapshot);
    assert.deepEqual(result.pullSummary, { source: "live" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot presence cannot make spec:sync succeed when live pull fails", async () => {
  const root = await temporaryRepo();
  const snapshotBefore = await readFile(path.join(root, SNAPSHOT_PATH), "utf8");
  try {
    await assert.rejects(
      syncFromLiveSource({
        repoRoot: root,
        pull: async () => { throw Object.assign(new Error("authentication missing"), { code: "SPEC_AUTH_MISSING" }); },
      }),
      (error) => error.code === "SPEC_AUTH_MISSING",
    );
    assert.equal(await readFile(path.join(root, SNAPSHOT_PATH), "utf8"), snapshotBefore);
    await assert.rejects(readFile(path.join(root, MANIFEST_PATH), "utf8"), (error) => error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Sheets timeout leaves every existing spec artifact byte-identical", async () => {
  const root = await temporaryRepo();
  try {
    await updateSpecifications({ rawSource: validRawSource(), repoRoot: root, generatedAt: () => "2026-09-03T00:00:00.000Z" });
    const before = await readOwnedFiles(root);
    await assert.rejects(
      syncFromLiveSource({
        repoRoot: root,
        fetchOptions: {
          env: { GOOGLE_SHEETS_ACCESS_TOKEN: "test-token" },
          limits: { requestTimeoutMs: 10, oauthResponseMaxBytes: 1024, sheetsResponseMaxBytes: 1024 },
          fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        },
      }),
      (error) => error.code === "SPEC_REMOTE_TIMEOUT",
    );
    assert.deepEqual(await readOwnedFiles(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Sheets size overflow leaves every existing spec artifact byte-identical", async () => {
  const root = await temporaryRepo();
  try {
    await updateSpecifications({ rawSource: validRawSource(), repoRoot: root, generatedAt: () => "2026-09-03T00:00:00.000Z" });
    const before = await readOwnedFiles(root);
    await assert.rejects(
      syncFromLiveSource({
        repoRoot: root,
        fetchOptions: {
          env: { GOOGLE_SHEETS_ACCESS_TOKEN: "test-token" },
          limits: { requestTimeoutMs: 1000, oauthResponseMaxBytes: 1024, sheetsResponseMaxBytes: 8 },
          fetchImpl: async () => new Response(JSON.stringify({ spreadsheetId: "oversized", sheets: [] })),
        },
      }),
      (error) => error.code === "SPEC_REMOTE_RESPONSE_TOO_LARGE",
    );
    assert.deepEqual(await readOwnedFiles(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manual snapshot content is comparison-only and is replaced by live source", async () => {
  const root = await temporaryRepo();
  const manualSnapshot = validSnapshot();
  manualSnapshot.sheets.find((sheet) => sheet.name === "01_要件定義").values[1][2] = "manual snapshot edit";
  await writeFile(path.join(root, SNAPSHOT_PATH), `${JSON.stringify(manualSnapshot, null, 2)}\n`, "utf8");
  const liveSnapshot = validSnapshot();
  try {
    await syncFromLiveSource({ repoRoot: root, pull: async () => ({ snapshot: liveSnapshot, summary: {} }) });
    assert.deepEqual(await readJson(SNAPSHOT_PATH, root), liveSnapshot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transaction rollback leaves every spec artifact byte-identical after an intermediate failure", async () => {
  const root = await temporaryRepo();
  try {
    await updateSpecifications({ rawSource: validRawSource(), repoRoot: root, generatedAt: () => "2026-09-03T00:00:00.000Z" });
    const before = await readOwnedFiles(root);
    const changedSnapshot = clone(validSnapshot());
    changedSnapshot.sheets.find((sheet) => sheet.name === "01_要件定義").values[1][2] = "transaction candidate";
    await assert.rejects(
      synchronizeSnapshot(changedSnapshot, {
        repoRoot: root,
        writeSnapshot: true,
        beforePromote: ({ index }) => {
          if (index === 1) throw new Error("simulated intermediate failure");
        },
      }),
      /simulated intermediate failure/u,
    );
    assert.deepEqual(await readOwnedFiles(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unchanged source second spec:update is a byte-preserving no-op", async () => {
  const root = await temporaryRepo();
  try {
    const first = await updateSpecifications({ rawSource: validRawSource(), repoRoot: root, generatedAt: () => "2026-09-03T00:00:00.000Z" });
    assert.equal(first.changed, true);
    const manifestBefore = await readFile(path.join(root, MANIFEST_PATH), "utf8");
    const second = await updateSpecifications({ rawSource: validRawSource(), repoRoot: root, generatedAt: () => "2099-01-01T00:00:00.000Z" });
    assert.equal(second.changed, false);
    assert.deepEqual(second.changedFiles, []);
    assert.equal(await readFile(path.join(root, MANIFEST_PATH), "utf8"), manifestBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated file manual edit changes the manifest hash", async () => {
  const root = await temporaryRepo();
  try {
    await updateSpecifications({ rawSource: validRawSource(), repoRoot: root });
    const manifest = await readJson(MANIFEST_PATH, root);
    await writeFile(path.join(root, GENERATED_SPEC_FILES[0]), "manual edit\n", "utf8");
    assert.notEqual(await hashGeneratedFiles(GENERATED_SPEC_FILES, root), manifest.generated_files_hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest cannot remove a generated file from the hash set", () => {
  assert.throws(() => assertGeneratedFileSet(GENERATED_SPEC_FILES.slice(1)), (error) => error.code === "SPEC_GENERATED_FILES_SET_INVALID");
  assert.doesNotThrow(() => assertGeneratedFileSet(GENERATED_SPEC_FILES));
});

test("no active task rejects source changes and accepts only valid spec-owned transactions", () => {
  assert.throws(
    () => validateGovernance({ changedPaths: ["src/domain/new.ts"], specStateValid: true }),
    (error) => error.code === "TASK_ACTIVE_MISSING",
  );
  assert.equal(
    validateGovernance({ changedPaths: [SNAPSHOT_PATH, MANIFEST_PATH], specStateValid: true }).mode,
    "SPEC_SYNC_TRANSACTION",
  );
});

test("forbidden_paths override allowed_paths", () => {
  const task = { id: "TASK-X", allowed_paths: ["scripts/**"], forbidden_paths: ["scripts/spec/secret.mjs"] };
  assert.equal(pathDecision("scripts/spec/normal.mjs", task).allowed, true);
  assert.deepEqual(pathDecision("scripts/spec/secret.mjs", task), { allowed: false, reason: "forbidden", pattern: "scripts/spec/secret.mjs" });
});

test("spec governance uses legacy glob semantics and repository-relative paths", () => {
  const task = { id: "TASK-X", allowed_paths: ["scripts/spec/*.mjs"], forbidden_paths: ["scripts/spec/check.*"] };
  assert.equal(validateGovernance({ changedPaths: ["scripts/spec/governance.mjs"], activeTask: task }).mode, "ACTIVE_TASK");
  for (const target of ["scripts/spec", "SCRIPTS/spec/governance.mjs", "governance.mjs"]) {
    assert.throws(() => validateGovernance({ changedPaths: [target], activeTask: task }), { code: "TASK_PATH_NOT_ALLOWED" });
  }
  assert.throws(() => validateGovernance({ changedPaths: ["scripts/spec/check.mjs"], activeTask: task }), { code: "TASK_PATH_FORBIDDEN" });
});

test("git status is requested as NUL-terminated porcelain v1", () => {
  let invocation;
  const output = readGitStatus({
    repoRoot: "fixture-repo",
    execFile: (command, args, options) => {
      invocation = { command, args, options };
      return "";
    },
  });
  assert.equal(output, "");
  assert.deepEqual(invocation.args, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  assert.equal(invocation.options.encoding, "utf8");
});

test("NUL parser preserves literal special paths and rename pairs", () => {
  const output = [
    " M normal.txt",
    "?? space name.txt",
    "?? 日本語-😀.txt",
    "?? tab\tname.txt",
    "?? line\nbreak.txt",
    "?? arrow -> literal.txt",
    "R  renamed -> target.txt",
    "old\tname.txt",
    "",
  ].join("\0");
  const entries = parseGitStatus(output);
  assert.deepEqual(entries, [
    { status: " M", path: "normal.txt", from: null },
    { status: "??", path: "space name.txt", from: null },
    { status: "??", path: "日本語-😀.txt", from: null },
    { status: "??", path: "tab\tname.txt", from: null },
    { status: "??", path: "line\nbreak.txt", from: null },
    { status: "??", path: "arrow -> literal.txt", from: null },
    { status: "R ", path: "renamed -> target.txt", from: "old\tname.txt" },
  ]);
  const task = {
    id: "MAINTENANCE-1",
    allowed_paths: entries.flatMap((entry) => [entry.path, entry.from]).filter(Boolean),
    forbidden_paths: [],
  };
  assert.doesNotThrow(() => validateGovernance({
    changedPaths: entries.flatMap((entry) => [entry.path, entry.from]).filter(Boolean),
    activeTask: task,
  }));
});

test("NUL parser fails closed on truncated or malformed records", () => {
  assert.throws(() => parseGitStatus("?? missing-terminator.txt"), (error) => error.code === "GIT_STATUS_INVALID");
  assert.throws(() => parseGitStatus("R  target.txt\0"), (error) => error.code === "GIT_STATUS_INVALID");
  assert.throws(() => parseGitStatus("malformed\0"), (error) => error.code === "GIT_STATUS_INVALID");
});

test("real Git fixture preserves spaces, Japanese, Unicode, and special characters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "study-app-git-status-"));
  const filenames = ["normal.txt", "space name.txt", "日本語-😀.txt", "special #![]()@.txt"];
  if (process.platform !== "win32") filenames.push("arrow -> literal.txt", "tab\tname.txt", "line\nbreak.txt");
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    await Promise.all(filenames.map((filename) => writeFile(path.join(root, filename), "fixture\n", "utf8")));
    const entries = parseGitStatus(readGitStatus({ repoRoot: root }));
    assert.deepEqual(new Set(entries.map((entry) => entry.path)), new Set(filenames));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active task stale fingerprint fails and sync has no task mutation path", async () => {
  assert.throws(
    () => assertActiveTaskCurrent(
      { id: "TASK-X", spec_version: "2026.09.01-v1", source_fingerprint: "sha256:" + "0".repeat(64) },
      { spec_version: "2026.09.01-v1", source_fingerprint: "sha256:" + "1".repeat(64) },
    ),
    (error) => error.code === "TASK_SOURCE_FINGERPRINT_MISMATCH",
  );
  const source = await readFile("scripts/spec/sync.mjs", "utf8");
  assert.doesNotMatch(source, /updateActiveTaskFingerprints|tasks\/active/u);
});

test("spec update never rewrites an active task fingerprint fixture", async () => {
  const root = await temporaryRepo();
  const taskPath = path.join(root, "tasks", "active", "TASK-X.md");
  await mkdir(path.dirname(taskPath), { recursive: true });
  const task = `---\nid: TASK-X\nstatus: ACTIVE\nspec_version: 2026.09.01-v1\nsource_fingerprint: sha256:${"7".repeat(64)}\n---\n`;
  await writeFile(taskPath, task, "utf8");
  try {
    await updateSpecifications({ rawSource: validRawSource(), repoRoot: root });
    assert.equal(await readFile(taskPath, "utf8"), task);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active task can transition only to its own completed path under its paths", () => {
  const task = {
    id: "TASK-SPEC-001",
    allowed_paths: ["tasks/active/TASK-SPEC-001.md", "tasks/completed/TASK-SPEC-001.md", "scripts/spec/**"],
    forbidden_paths: [],
  };
  const result = validateGovernance({
    changedPaths: ["tasks/active/TASK-SPEC-001.md", "tasks/completed/TASK-SPEC-001.md", "scripts/spec/check.mjs"],
    completionTask: task,
  });
  assert.equal(result.mode, "TASK_COMPLETION");
});

test("source traceability is separate from implementation status", () => {
  const traceability = JSON.parse(renderGeneratedFiles(validSnapshot()).get("docs/traceability.yaml"));
  assert.ok(traceability.source_relationships);
  assert.equal(traceability.implementation_mapping, "scripts/spec/implementation-traceability.json");
  assert.equal("artifacts" in traceability, false);
});
