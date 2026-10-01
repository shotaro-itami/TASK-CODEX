import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCodexForProfile } from "./codex-profile.mjs";
import { selectTaskExecutionProfile } from "./codex-profile-selection.mjs";
import { MANIFEST_PATH, REPO_ROOT } from "./spec/config.mjs";
import { assertActiveTaskCurrent, assertChangedPathsAllowed, assertTaskScope, readChangedPaths, readGitHead, resolveScopePath } from "./spec/governance.mjs";
import { SpecError, printSpecError } from "./spec/errors.mjs";
import { listMarkdownFiles, parseTaskFrontmatter, readJson } from "./spec/lib.mjs";

export class CodexTaskError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CodexTaskError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CodexTaskError(code, message);
}

export async function runCodexForTask(
  args,
  { repoRoot = REPO_ROOT, cwd = process.cwd(), spawn } = {},
) {
  if (args.length !== 1 || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(args[0])) {
    fail("CODEX_TASK_USAGE", "usage: pnpm run codex:task <TASK-ID>; no additional arguments");
  }

  const root = await realpath(repoRoot);
  if (await realpath(cwd) !== root) {
    fail("CODEX_TASK_CWD_INVALID", "run from the repository root");
  }

  const taskPath = `tasks/active/${args[0]}.md`;
  const activeTasks = await listMarkdownFiles("tasks/active", root);
  if (activeTasks.length !== 1 || activeTasks[0] !== taskPath) {
    fail("CODEX_TASK_ACTIVE_MISMATCH", "expected the requested TASK to be the sole active TASK");
  }
  if (await realpath(resolve(root, taskPath)) !== resolve(root, taskPath)) {
    fail("CODEX_TASK_PATH_INVALID", "active TASK must not resolve through a link");
  }

  const content = await readFile(resolve(root, taskPath), "utf8");
  let task;
  try { task = parseTaskFrontmatter(content, { strict: true }); } catch (error) {
    fail("CODEX_TASK_METADATA_INVALID", error.message);
  }
  if (task.id !== args[0] || task.status !== "ACTIVE") {
    fail("CODEX_TASK_METADATA_INVALID", "TASK id and ACTIVE status must match the requested TASK");
  }
  const manifest = await readJson(MANIFEST_PATH, root);
  assertActiveTaskCurrent(task, manifest);

  if (Object.hasOwn(task, "execution_profile") && (typeof task.execution_profile !== "string" || task.execution_profile.length === 0)) {
    fail("CODEX_TASK_PROFILE_REQUIRED", "TASK must declare one scalar execution_profile");
  }

  assertTaskScope(task);
  const scope = Object.freeze({
    id: task.id,
    allowed_paths: Object.freeze([...task.allowed_paths]),
    forbidden_paths: Object.freeze([...task.forbidden_paths]),
  });
  for (const pattern of [...scope.allowed_paths, ...scope.forbidden_paths]) {
    // Only the literal directory prefix of a glob is a filesystem path.
    const normalized = process.platform === "win32" ? pattern.replaceAll("\\", "/") : pattern;
    const star = normalized.indexOf("*");
    const prefix = star < 0 ? normalized : normalized.slice(0, normalized.lastIndexOf("/", star));
    if (star < 0 || normalized.lastIndexOf("/", star) >= 0) resolveScopePath(prefix, root);
  }
  const startHead = readGitHead({ repoRoot: root });
  assertChangedPathsAllowed(readChangedPaths({ repoRoot: root }), scope, { repoRoot: root });

  let selection;
  try { selection = selectTaskExecutionProfile(task, content, { repoRoot: root }); } catch (error) {
    if (typeof error?.code === "string") throw error;
    fail("CODEX_TASK_PROFILE_SELECTION_FAILED", "profile selector failed; Codex was not started");
  }
  if (!["light", "standard", "deep", "review"].includes(selection?.selected_profile)) {
    fail("CODEX_TASK_PROFILE_SELECTION_FAILED", "selector returned an unsupported profile");
  }
  process.stderr.write(`${JSON.stringify(selection)}\n`);

  const prompt = `Read AGENTS.md and docs/product-specs/index.md, then ${taskPath} and its related_specs. Work only on ${task.id} within its allowed_paths and acceptance criteria. The execution profile and scope were read from this TASK at launch. Do not change that selection during this session; stop and relaunch if a different profile or scope is required. Follow the TASK's validation and completion rules.`;
  let status;
  let childError;
  try { status = await runCodexForProfile(selection.selected_profile, ["--", prompt], { spawn }); } catch (error) { childError = error; }
  try {
    assertChangedPathsAllowed(readChangedPaths({ repoRoot: root, startHead }), scope, { repoRoot: root });
  } catch (error) {
    if (error instanceof SpecError) error.actual = `postflight (child ${childError?.code ?? status}): ${error.actual}`;
    throw error;
  }
  if (childError) throw childError;
  return status;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await runCodexForTask(process.argv.slice(2));
  } catch (error) {
    if (error instanceof SpecError) printSpecError(error);
    else process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
