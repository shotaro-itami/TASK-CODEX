import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./config.mjs";
import { SpecError } from "./errors.mjs";
import { parseTaskFrontmatter } from "./lib.mjs";

export const TASK_ANCHOR_SCHEMA_VERSION = 1;
export const TASK_ANCHOR_DIRECTORY = "tasks/anchors";

const ANCHOR_KEYS = [
  "schema_version",
  "task_id",
  "task_path",
  "task_sha256",
  "req_references",
  "bas_references",
  "det_references",
  "chk_references",
  "recorded_source_fingerprint",
];

const REFERENCE_FIELDS = [
  ["REQ", "req_references"],
  ["BAS", "bas_references"],
  ["DET", "det_references"],
  ["CHK", "chk_references"],
];

function fail(code, target, expected, actual) {
  throw new SpecError(code, target, expected, actual, "REQ-038,REQ-041,DET-075,DET-086");
}

function normalizeRepoPath(value) {
  return String(value).replaceAll("\\", "/");
}

function exactBytesSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedReferences(task, prefix) {
  const references = (task.related_specs ?? []).filter((id) => id.startsWith(`${prefix}-`));
  return [...new Set(references)].sort();
}

function assertCompletedTaskPath(taskPath) {
  if (!/^tasks\/completed\/[^/]+\.md$/u.test(taskPath)) {
    fail("TASK_ANCHOR_TASK_INVALID", taskPath, "repository-relative tasks/completed/*.md path", "invalid task path");
  }
}

export function anchorPathForTask(taskPath) {
  const normalized = normalizeRepoPath(taskPath);
  const filename = path.posix.basename(normalized, ".md");
  return `${TASK_ANCHOR_DIRECTORY}/${filename}.json`;
}

export function buildTaskAnchor({ taskPath, taskBytes }) {
  const normalizedTaskPath = normalizeRepoPath(taskPath);
  assertCompletedTaskPath(normalizedTaskPath);
  const bytes = Buffer.isBuffer(taskBytes) ? taskBytes : Buffer.from(taskBytes);
  const task = parseTaskFrontmatter(bytes.toString("utf8"));
  if (!task) fail("TASK_ANCHOR_TASK_INVALID", normalizedTaskPath, "completed TASK with frontmatter", "frontmatter missing");
  if (task.status !== "COMPLETED") fail("TASK_ANCHOR_TASK_INVALID", normalizedTaskPath, "status COMPLETED", task.status ?? "missing");
  if (!task.id) fail("TASK_ANCHOR_TASK_INVALID", normalizedTaskPath, "task id", "missing");
  if (path.posix.basename(normalizedTaskPath, ".md") !== task.id) {
    fail("TASK_ANCHOR_TASK_INVALID", normalizedTaskPath, "filename matching task id", task.id);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(task.source_fingerprint ?? "")) {
    fail("TASK_ANCHOR_TASK_INVALID", normalizedTaskPath, "recorded sha256 source fingerprint", task.source_fingerprint ?? "missing");
  }
  for (const reference of task.related_specs ?? []) {
    if (!/^(REQ|BAS|DET|CHK)-\d{3}$/u.test(reference)) {
      fail("TASK_ANCHOR_TASK_INVALID", normalizedTaskPath, "REQ/BAS/DET/CHK reference", reference);
    }
  }
  return {
    schema_version: TASK_ANCHOR_SCHEMA_VERSION,
    task_id: task.id,
    task_path: normalizedTaskPath,
    task_sha256: exactBytesSha256(bytes),
    req_references: sortedReferences(task, "REQ"),
    bas_references: sortedReferences(task, "BAS"),
    det_references: sortedReferences(task, "DET"),
    chk_references: sortedReferences(task, "CHK"),
    recorded_source_fingerprint: task.source_fingerprint,
  };
}

export function serializeTaskAnchor(anchor) {
  return `${JSON.stringify(anchor, null, 2)}\n`;
}

function assertStringArray(value, prefix, target) {
  if (!Array.isArray(value)) fail("TASK_ANCHOR_SCHEMA_INVALID", target, `${prefix} reference array`, typeof value);
  const expected = [...new Set(value)].sort();
  if (value.some((item) => typeof item !== "string" || !new RegExp(`^${prefix}-\\d{3}$`, "u").test(item))) {
    fail("TASK_ANCHOR_SCHEMA_INVALID", target, `${prefix}-NNN references`, "invalid reference");
  }
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    fail("TASK_ANCHOR_SCHEMA_INVALID", target, "sorted unique references", "unsorted or duplicate references");
  }
}

export function validateTaskAnchorSchema(anchor, anchorPath) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, "anchor object", typeof anchor);
  }
  if (JSON.stringify(Object.keys(anchor)) !== JSON.stringify(ANCHOR_KEYS)) {
    fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, ANCHOR_KEYS.join(","), Object.keys(anchor).join(","));
  }
  if (anchor.schema_version !== TASK_ANCHOR_SCHEMA_VERSION) {
    fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, String(TASK_ANCHOR_SCHEMA_VERSION), String(anchor.schema_version));
  }
  if (!/^[A-Z0-9-]+$/u.test(anchor.task_id ?? "")) fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, "stable task_id", anchor.task_id ?? "missing");
  if (!/^tasks\/completed\/[^/]+\.md$/u.test(anchor.task_path ?? "")) fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, "repository-relative completed task path", anchor.task_path ?? "missing");
  if (!/^[0-9a-f]{64}$/u.test(anchor.task_sha256 ?? "")) fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, "lowercase SHA-256", anchor.task_sha256 ?? "missing");
  for (const [prefix, field] of REFERENCE_FIELDS) assertStringArray(anchor[field], prefix, anchorPath);
  if (!/^sha256:[0-9a-f]{64}$/u.test(anchor.recorded_source_fingerprint ?? "")) {
    fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, "recorded sha256 source fingerprint", anchor.recorded_source_fingerprint ?? "missing");
  }
  return anchor;
}

async function listFiles(relativeDirectory, suffix, repoRoot) {
  let entries;
  try {
    entries = await readdir(path.join(repoRoot, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => `${relativeDirectory}/${entry.name}`)
    .sort();
}

function isNewAnchorStatus(status) {
  return status === "??" || status === "A " || status === " A";
}

function gitOutput(execFile, args, repoRoot, encoding = "utf8") {
  return execFile("git", args, { cwd: repoRoot, encoding });
}

export async function assertAnchorsAppendOnly({ anchorPaths, gitEntries = [], repoRoot = REPO_ROOT, execFile = execFileSync }) {
  const anchorChanges = gitEntries.filter((entry) =>
    entry.path.startsWith(`${TASK_ANCHOR_DIRECTORY}/`) || entry.from?.startsWith(`${TASK_ANCHOR_DIRECTORY}/`));
  for (const entry of anchorChanges) {
    if (!entry.from && entry.path.startsWith(`${TASK_ANCHOR_DIRECTORY}/`) && isNewAnchorStatus(entry.status)) continue;
    fail("TASK_ANCHOR_HISTORY_CHANGED", entry.path, "new anchor addition only", entry.status);
  }

  const newAnchorPaths = new Set(anchorChanges.filter((entry) => isNewAnchorStatus(entry.status)).map((entry) => entry.path));
  for (const anchorPath of anchorPaths) {
    const log = String(gitOutput(execFile, ["log", "--format=%H", "--diff-filter=A", "--", anchorPath], repoRoot)).trim();
    const additions = log ? log.split(/\r?\n/u).filter(Boolean) : [];
    if (newAnchorPaths.has(anchorPath)) {
      if (additions.length > 0) fail("TASK_ANCHOR_HISTORY_CHANGED", anchorPath, "never previously committed", "anchor path was re-added");
      continue;
    }
    if (additions.length !== 1) fail("TASK_ANCHOR_HISTORY_CHANGED", anchorPath, "exactly one Git addition", `${additions.length} additions`);
    const original = gitOutput(execFile, ["show", `${additions[0]}:${anchorPath}`], repoRoot, null);
    const current = await readFile(path.join(repoRoot, anchorPath));
    if (!Buffer.from(original).equals(current)) fail("TASK_ANCHOR_HISTORY_CHANGED", anchorPath, "original Git blob bytes", "current bytes differ");
  }
}

export async function verifyCompletedTaskAnchors({
  repoRoot = REPO_ROOT,
  gitEntries = [],
  execFile = execFileSync,
  enforceGitHistory = true,
} = {}) {
  const taskPaths = await listFiles("tasks/completed", ".md", repoRoot);
  const anchorPaths = await listFiles(TASK_ANCHOR_DIRECTORY, ".json", repoRoot);
  if (enforceGitHistory) await assertAnchorsAppendOnly({ anchorPaths, gitEntries, repoRoot, execFile });

  const tasksById = new Map();
  const expectedByPath = new Map();
  for (const taskPath of taskPaths) {
    const taskBytes = await readFile(path.join(repoRoot, taskPath));
    const expected = buildTaskAnchor({ taskPath, taskBytes });
    if (tasksById.has(expected.task_id)) fail("TASK_ANCHOR_DUPLICATE", taskPath, "unique completed task id", expected.task_id);
    tasksById.set(expected.task_id, expected);
    expectedByPath.set(taskPath, expected);
  }

  const seenIds = new Set();
  const seenTaskPaths = new Set();
  for (const anchorPath of anchorPaths) {
    let anchor;
    let anchorText;
    try {
      anchorText = await readFile(path.join(repoRoot, anchorPath), "utf8");
      anchor = JSON.parse(anchorText);
    } catch {
      fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, "valid JSON", "unreadable or malformed");
    }
    validateTaskAnchorSchema(anchor, anchorPath);
    if (anchorText !== serializeTaskAnchor(anchor)) {
      fail("TASK_ANCHOR_SCHEMA_INVALID", anchorPath, "canonical JSON with LF and final newline", "non-canonical serialization");
    }
    if (seenIds.has(anchor.task_id) || seenTaskPaths.has(anchor.task_path)) {
      fail("TASK_ANCHOR_DUPLICATE", anchorPath, "unique task_id and task_path", anchor.task_id);
    }
    seenIds.add(anchor.task_id);
    seenTaskPaths.add(anchor.task_path);
    const expected = expectedByPath.get(anchor.task_path);
    if (!expected) fail("TASK_ANCHOR_ORPHAN", anchorPath, "existing completed TASK", anchor.task_path);
    if (anchorPath !== anchorPathForTask(anchor.task_path)) fail("TASK_ANCHOR_PATH_MISMATCH", anchorPath, anchorPathForTask(anchor.task_path), anchorPath);
    if (anchor.task_id !== expected.task_id) fail("TASK_ANCHOR_ID_MISMATCH", anchorPath, expected.task_id, anchor.task_id);
    if (anchor.task_sha256 !== expected.task_sha256) fail("TASK_ANCHOR_HASH_MISMATCH", anchor.task_path, expected.task_sha256, anchor.task_sha256);
    for (const [, field] of REFERENCE_FIELDS) {
      if (JSON.stringify(anchor[field]) !== JSON.stringify(expected[field])) {
        fail("TASK_ANCHOR_REFERENCES_MISMATCH", anchor.task_path, JSON.stringify(expected[field]), JSON.stringify(anchor[field]));
      }
    }
    if (anchor.recorded_source_fingerprint !== expected.recorded_source_fingerprint) {
      fail("TASK_ANCHOR_FINGERPRINT_MISMATCH", anchor.task_path, expected.recorded_source_fingerprint, anchor.recorded_source_fingerprint);
    }
  }

  for (const expected of tasksById.values()) {
    if (!seenIds.has(expected.task_id)) fail("TASK_ANCHOR_MISSING", expected.task_path, anchorPathForTask(expected.task_path), "missing");
  }

  return { completedTasks: taskPaths.length, anchors: anchorPaths.length };
}

export async function writeTaskAnchor(taskPath, repoRoot = REPO_ROOT) {
  const normalizedTaskPath = normalizeRepoPath(taskPath);
  assertCompletedTaskPath(normalizedTaskPath);
  const taskBytes = await readFile(path.join(repoRoot, normalizedTaskPath));
  const anchor = buildTaskAnchor({ taskPath: normalizedTaskPath, taskBytes });
  const anchorPath = anchorPathForTask(normalizedTaskPath);
  await mkdir(path.join(repoRoot, TASK_ANCHOR_DIRECTORY), { recursive: true });
  try {
    await writeFile(path.join(repoRoot, anchorPath), serializeTaskAnchor(anchor), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") fail("TASK_ANCHOR_IMMUTABLE", anchorPath, "new anchor path", "already exists");
    throw error;
  }
  return anchorPath;
}

async function main(args) {
  let taskPaths = args.slice(1);
  if (args[0] === "--write-all") taskPaths = await listFiles("tasks/completed", ".md", REPO_ROOT);
  else if (args[0] !== "--write" || taskPaths.length === 0) {
    fail("TASK_ANCHOR_COMMAND_INVALID", "task anchor command", "--write <task...> or --write-all", args.join(" "));
  }
  for (const taskPath of taskPaths.sort()) console.log(await writeTaskAnchor(taskPath));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.code ?? "TASK_ANCHOR_UNEXPECTED");
    console.error(`target: ${error.target ?? "task anchor"}`);
    console.error(`expected: ${error.expected ?? "success"}`);
    console.error(`actual: ${error.actual ?? "unexpected failure"}`);
    process.exitCode = 1;
  });
}
