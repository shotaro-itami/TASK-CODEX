import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, SPEC_SYNC_OWNED_FILES } from "./config.mjs";
import { SpecError } from "./errors.mjs";
import { parseTaskFrontmatter } from "./lib.mjs";

function normalizePath(value) {
  return path.sep === "\\" ? value.replaceAll("\\", "/") : value;
}

// Keep repository containment checks separate from the legacy glob semantics.
export function assertScopePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-z]:/iu.test(value) ||
      value.replaceAll("\\", "/").split("/").some((segment) => segment === "." || segment === "..")) {
    throw new SpecError("TASK_SCOPE_PATH_INVALID", String(value), "repository-relative path without traversal", "invalid path syntax", "DET-076");
  }
  return normalizePath(value);
}

export function assertTaskScope(task) {
  for (const key of ["allowed_paths", "forbidden_paths"]) {
    const values = task?.[key];
    if (!Array.isArray(values) || (key === "allowed_paths" && values.length === 0)) {
      throw new SpecError("TASK_SCOPE_METADATA_INVALID", key, key === "allowed_paths" ? "nonempty array" : "array (empty permitted)", values, "DET-075");
    }
    for (const value of values) {
      if (typeof value !== "string") {
        throw new SpecError("TASK_SCOPE_METADATA_INVALID", key, "array of path strings", value, "DET-075");
      }
      assertScopePath(value);
    }
  }
  return task;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function pathMatchesPattern(relativePath, pattern) {
  const target = normalizePath(relativePath);
  const source = normalizePath(pattern);
  const marker = "\u0000";
  const regex = escapeRegex(source)
    .replaceAll("**", marker)
    .replaceAll("*", "[^/]*")
    .replaceAll(marker, ".*");
  return new RegExp(`^${regex}$`, "u").test(target);
}

export function pathDecision(relativePath, task) {
  assertScopePath(relativePath);
  assertTaskScope(task);
  const forbidden = (task?.forbidden_paths ?? []).find((pattern) => pathMatchesPattern(relativePath, pattern));
  if (forbidden) return { allowed: false, reason: "forbidden", pattern: forbidden };
  const allowed = (task?.allowed_paths ?? []).find((pattern) => pathMatchesPattern(relativePath, pattern));
  return allowed ? { allowed: true, reason: "allowed", pattern: allowed } : { allowed: false, reason: "not-allowed", pattern: null };
}

export function parseGitStatus(output) {
  if (output === "") return [];
  const records = output.split("\0");
  if (records.at(-1) !== "") {
    throw new SpecError("GIT_STATUS_INVALID", "git status", "NUL-terminated porcelain v1 records", "missing final NUL");
  }
  records.pop();
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== " ") {
      throw new SpecError("GIT_STATUS_INVALID", "git status", "XY path NUL record", "malformed record");
    }
    const status = record.slice(0, 2);
    if (status !== "??" && !/^(?: [MTADRC]|[MTARC][ MTD]|D )$/u.test(status)) {
      throw new SpecError("GIT_STATUS_INVALID", "git status", "supported non-conflicting XY status", status);
    }
    const target = record.slice(3);
    let from = null;
    if (/[RC]/u.test(status)) {
      index += 1;
      if (index >= records.length || records[index] === "") {
        throw new SpecError("GIT_STATUS_INVALID", "git status", "rename/copy source path record", "missing source path");
      }
      from = records[index];
    }
    entries.push({ status, path: target, from });
  }
  return entries;
}

export function readGitStatus({ repoRoot = REPO_ROOT, execFile = execFileSync } = {}) {
  return readGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { repoRoot, execFile });
}

function readGit(args, { repoRoot = REPO_ROOT, execFile = execFileSync } = {}) {
  try {
    const output = execFile("git", args, { cwd: repoRoot, encoding: "utf8" });
    if (typeof output !== "string") throw new Error("expected text output");
    return output;
  } catch (error) {
    throw new SpecError("TASK_SCOPE_GIT_FAILED", `git ${args.join(" ")}`, "successful Git observation", error.message, "DET-076");
  }
}

export function readGitHead(options) {
  const root = options?.repoRoot ?? REPO_ROOT;
  const topLevel = readGit(["rev-parse", "--show-toplevel"], options).trim();
  if (path.resolve(topLevel) !== path.resolve(root)) {
    throw new SpecError("TASK_SCOPE_GIT_FAILED", "git repository root", path.resolve(root), topLevel, "DET-076");
  }
  const head = readGit(["rev-parse", "--verify", "HEAD"], options).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head)) {
    throw new SpecError("TASK_SCOPE_GIT_INVALID", "HEAD", "commit object id", head, "DET-076");
  }
  return head;
}

export function parseGitDiffPaths(output) {
  if (output === "") return [];
  const records = output.split("\0");
  const invalid = () => { throw new SpecError("TASK_SCOPE_GIT_INVALID", "git diff", "NUL-terminated name-status records", "malformed or unsupported status", "DET-076"); };
  if (records.pop() !== "") invalid();
  const paths = [];
  for (let index = 0; index < records.length;) {
    const status = records[index++];
    const pair = /^[RC](?:100|[0-9]{1,2})$/u.test(status);
    if (!pair && !/^[AMDT]$/u.test(status)) invalid();
    for (let count = 0; count < (pair ? 2 : 1); count += 1) {
      const value = records[index++];
      if (!value) invalid();
      paths.push(value);
    }
  }
  return paths;
}

export function gitChangedPaths(entries) {
  return [...new Set(entries.flatMap((entry) => [entry.from, entry.path]).filter(Boolean))];
}

export function readChangedPaths({ startHead, ...options } = {}) {
  const paths = gitChangedPaths(parseGitStatus(readGitStatus(options)));
  if (startHead) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(startHead)) throw new SpecError("TASK_SCOPE_GIT_INVALID", "start HEAD", "commit object id", startHead);
    const endHead = readGitHead(options);
    paths.push(...parseGitDiffPaths(readGit(["diff", "--name-status", "-z", "--no-ext-diff", "--no-textconv", "--find-renames", startHead, endHead, "--"], options)));
  }
  return [...new Set(paths)];
}

// Resolve each existing prefix, including links. Missing leaves are checked
// against their existing parent; dangling links and read failures reject.
export function resolveScopePath(relativePath, repoRoot = REPO_ROOT) {
  const normalized = assertScopePath(relativePath);
  const root = realpathSync(repoRoot);
  let current = root;
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment);
    let exists = true;
    try { lstatSync(current); } catch (error) {
      if (error.code !== "ENOENT") throw new SpecError("TASK_SCOPE_PATH_UNRESOLVED", relativePath, "readable path or existing parent", error.code, "DET-076");
      exists = false;
    }
    if (exists) {
      try { current = realpathSync(current); } catch (error) {
        throw new SpecError("TASK_SCOPE_PATH_UNRESOLVED", relativePath, "resolvable existing path", error.code, "DET-076");
      }
    }
    const relative = path.relative(root, current);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new SpecError("TASK_SCOPE_PATH_OUTSIDE", relativePath, "resolved path inside repository", current, "DET-076");
    }
  }
  return normalizePath(path.relative(root, current));
}

export function assertChangedPathsAllowed(changedPaths, task, { repoRoot = REPO_ROOT } = {}) {
  assertTaskScope(task);
  for (const relativePath of changedPaths) {
    for (const target of new Set([relativePath, resolveScopePath(relativePath, repoRoot)])) {
      const decision = pathDecision(target, task);
      if (!decision.allowed) {
        const code = decision.reason === "forbidden" ? "TASK_PATH_FORBIDDEN" : "TASK_PATH_NOT_ALLOWED";
        throw new SpecError(code, relativePath, `${task.id} allowed and not forbidden`, `${target}: ${decision.pattern ?? "no matching allowed_paths"}`, task.id);
      }
    }
  }
}

export function assertSpecTransactionPaths(changedPaths) {
  for (const relativePath of changedPaths) {
    if (!SPEC_SYNC_OWNED_FILES.includes(normalizePath(relativePath))) {
      throw new SpecError("TASK_ACTIVE_MISSING", relativePath, "active task or exact spec-sync owned transaction", "unowned change");
    }
  }
}

export function validateGovernance({ changedPaths, activeTask = null, completionTask = null, specStateValid = false, repoRoot = REPO_ROOT }) {
  const governingTask = activeTask ?? completionTask;
  if (governingTask) {
    assertChangedPathsAllowed(changedPaths, governingTask, { repoRoot });
    return { mode: completionTask && !activeTask ? "TASK_COMPLETION" : "ACTIVE_TASK", taskId: governingTask.id };
  }
  if (changedPaths.length === 0) return { mode: "CLEAN", taskId: null };
  if (!specStateValid) throw new SpecError("TASK_ACTIVE_MISSING", changedPaths[0], "active task or internally consistent spec-sync transaction", "no governing task");
  assertSpecTransactionPaths(changedPaths);
  return { mode: "SPEC_SYNC_TRANSACTION", taskId: null };
}

export function assertActiveTaskCurrent(task, manifest) {
  if (task.spec_version !== manifest.spec_version) {
    throw new SpecError("TASK_SPEC_VERSION_MISMATCH", task.id, manifest.spec_version, task.spec_version);
  }
  if (task.source_fingerprint !== manifest.source_fingerprint) {
    throw new SpecError("TASK_SOURCE_FINGERPRINT_MISMATCH", task.id, manifest.source_fingerprint, task.source_fingerprint);
  }
}

export async function readTask(relativePath, repoRoot = REPO_ROOT, { strict = true } = {}) {
  const content = await readFile(path.join(repoRoot, relativePath), "utf8");
  const task = parseTaskFrontmatter(content, { strict });
  if (!task) throw new SpecError("TASK_METADATA_MISSING", relativePath, "YAML frontmatter", "not found");
  return { content, task };
}

export async function findCompletionTask(entries, repoRoot = REPO_ROOT) {
  const removed = entries.flatMap((entry) => [
    ...(entry.status.includes("D") ? [entry.path] : []),
    ...(entry.status.includes("R") && entry.from ? [entry.from] : []),
  ]).filter((target) => /^tasks\/active\/[^/]+\.md$/u.test(target));
  if (removed.length > 1) throw new SpecError("TASK_COMPLETION_INVALID", "tasks/active", "single TASK completion", removed.join(","));
  if (removed.length === 1) {
    const previous = parseTaskFrontmatter(readGit(["show", `HEAD:${removed[0]}`], { repoRoot }), { strict: true });
    const destination = removed[0].replace("tasks/active/", "tasks/completed/");
    if (!entries.some((entry) => entry.path === destination && !entry.status.includes("D"))) return null;
    const { task: current } = await readTask(destination, repoRoot);
    if (previous.id === current.id && previous.status === "ACTIVE" && current.status === "COMPLETED") return assertTaskScope(previous);
    return null;
  }
  // Preserve completion of a TASK created and completed before its first commit.
  const isAdded = (entry) => ["??", "A ", "AM", " A"].includes(entry.status);
  const added = entries.filter((entry) => /^tasks\/completed\/[^/]+\.md$/u.test(entry.path) && isAdded(entry));
  if (added.length === 1) {
    const { task } = await readTask(added[0].path, repoRoot);
    if (task.status === "COMPLETED" && added[0].path === `tasks/completed/${task.id}.md` &&
        entries.some((entry) => entry.path === `tasks/anchors/${task.id}.json` && isAdded(entry))) return assertTaskScope(task);
  }
  return null;
}
