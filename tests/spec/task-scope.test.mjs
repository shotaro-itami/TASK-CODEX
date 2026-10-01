import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertChangedPathsAllowed, assertTaskScope, findCompletionTask, gitChangedPaths,
  parseGitDiffPaths, parseGitStatus, pathDecision, pathMatchesPattern, readChangedPaths, readGitHead,
  readGitStatus, resolveScopePath, validateGovernance,
} from "../../scripts/spec/governance.mjs";
import { parseTaskFrontmatter } from "../../scripts/spec/lib.mjs";
import { verifyCompletedTaskAnchors, writeTaskAnchor } from "../../scripts/spec/task-anchors.mjs";

const scope = { id: "TASK-X", allowed_paths: ["exact.txt", "allowed/**"], forbidden_paths: ["allowed/secret.txt", "allowed/private/**"] };
const ownPaths = ["tasks/active/TASK-X.md", "tasks/completed/TASK-X.md", "tasks/anchors/TASK-X.json"];

// Frozen characterization oracle: governance.mjs at 0a4768aab2c4c3f105e72779fbfb8780424fe9bf.
// Production callers share pathMatchesPattern; this copy exists only to detect semantic drift.
function legacyMatch(relativePath, pattern) {
  const normalize = (value) => path.sep === "\\" ? value.replaceAll("\\", "/") : value;
  const marker = "\u0000";
  const regex = normalize(pattern).replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replaceAll("**", marker).replaceAll("*", "[^/]*").replaceAll(marker, ".*");
  return new RegExp(`^${regex}$`, "u").test(normalize(relativePath));
}

for (const [target, pattern, expected] of [
  ["exact.txt", "exact.txt", true], ["other.txt", "exact.txt", false],
  ["next.config.mjs", "next.config.*", true],
  ["question_evidence_pack.py", "question_evidence_*.py", true],
  ["allowed/a.txt", "allowed/*.txt", true], ["allowed/deep/a.txt", "allowed/*.txt", false],
  ["allowed/deep/a.txt", "allowed/**", true], ["allowed/a.txt", "allowed/**", true],
  ["allowed", "allowed/**", false], ["allowed/", "allowed/**", true],
  ["EXACT.txt", "exact.txt", false], ["ALLOWED/a.txt", "allowed/**", false],
  ["a/b", "**", true], ["a/b", "*", false], ["abc", "a**c", true],
  ["x/a/b/end", "x/**/end", true], ["x/end", "x/**/end", false],
  ["literal[ab]?.txt", "literal[ab]?.txt", true], ["literala1.txt", "literal[ab]?.txt", false],
  ["a+b.(txt)", "a+b.(txt)", true], ["23", "23", true],
  ["tab\tname.txt", "tab\tname.txt", true], ["line\nbreak.txt", "*", true],
  ["line\nbreak.txt", "**", false],
  ["allowed\\a.txt", "allowed/*.txt", process.platform === "win32"],
  ["allowed/a.txt", "allowed\\*.txt", process.platform === "win32"],
  ["src/a.txt", "a.txt", false], ["/repo/a.txt", "a.txt", false],
]) {
  test(`characterization ${JSON.stringify(target)} against ${JSON.stringify(pattern)}`, () => {
    assert.equal(legacyMatch(target, pattern), expected);
    assert.equal(pathMatchesPattern(target, pattern), expected);
  });
}

test("characterization of every scope expression in existing TASK files", async () => {
  let patterns = 0;
  for (const directory of ["tasks/active", "tasks/completed"]) {
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".md"))) {
      const content = await readFile(path.join(directory, name), "utf8");
      const task = parseTaskFrontmatter(content);
      assertTaskScope(task);
      assert.deepEqual({ ...parseTaskFrontmatter(content, { strict: true }) }, task);
      for (const pattern of [...task.allowed_paths, ...task.forbidden_paths]) {
        patterns += 1;
        const sample = pattern.replaceAll("**", "nested/file").replaceAll("*", "sample");
        for (const target of [sample, sample.toUpperCase(), `${sample}/child`, `prefix/${sample}`, pattern.replace(/\/\*\*$/u, "")]) {
          assert.equal(pathMatchesPattern(target, pattern), legacyMatch(target, pattern), `${name}: ${target} / ${pattern}`);
        }
      }
    }
  }
  assert.ok(patterns > 100);
});

test("characterization of legacy flat scope values including numeric-looking strings and empty elements", () => {
  for (const [raw, expected] of [
    ["[23]", ["23"]], ["[true, null, 0xFF, 1e3, .nan]", ["true", "null", "0xFF", "1e3", ".nan"]],
    ["[safe,,other,]", ["safe", "other"]], ["[[safe]]", ["[safe]"]],
    ["['safe']", ["'safe'"]], ["[ ]", []], ["scalar", "scalar"], ["[unclosed", "[unclosed"],
  ]) {
    const content = `---\nallowed_paths: ${raw}\nforbidden_paths: []\n---\n`;
    const task = parseTaskFrontmatter(content, { strict: true });
    assert.deepEqual(task.allowed_paths, expected);
    assert.deepEqual(task.allowed_paths, parseTaskFrontmatter(content).allowed_paths);
    if (Array.isArray(expected) && expected.length) assertTaskScope(task);
    else assert.throws(() => assertTaskScope(task), { code: "TASK_SCOPE_METADATA_INVALID" });
  }
});
function taskText() {
  return `---\nid: TASK-X\nstatus: ACTIVE\nspec_version: 2026.09.01-v1\nsource_fingerprint: sha256:${"a".repeat(64)}\nallowed_paths: [${[...ownPaths, "allowed/**"].join(", ")}]\nforbidden_paths: []\n---\n${"Completion fixture body.\n".repeat(30)}`;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function commit(root) {
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]);
}
async function put(root, target, content = "fixture\n") {
  await mkdir(path.dirname(path.join(root, target)), { recursive: true });
  await writeFile(path.join(root, target), content);
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "study-app-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ["init", "--quiet"]);
  await put(root, "exact.txt");
  await put(root, "allowed/file.txt");
  await put(root, "tasks/active/TASK-X.md", taskText());
  commit(root);
  return root;
}

test("exact, directory descendants and multiple allowed paths; forbidden wins", () => {
  for (const target of ["exact.txt", "allowed/file.txt", "allowed/nested/file.txt"]) assert.equal(pathDecision(target, scope).allowed, true);
  for (const target of ["outside.txt", "allowedness/file.txt", "EXACT.txt", "allowed", "ALLOWED/SECRET.TXT"]) assert.equal(pathDecision(target, scope).reason, "not-allowed");
  for (const target of ["allowed/secret.txt", "allowed/private/file.txt"]) assert.equal(pathDecision(target, scope).reason, "forbidden");
  assert.equal(pathDecision("allowed/private", scope).allowed, true);
});

for (const target of [
  "../x", "allowed/../x", ".", "./x", "allowed/./x", "allowed\\..\\x", "/x", "C:/x", "C:x", "\\\\host\\share", "//host/share", "allowed/a\0b",
]) {
  test(`reject unsafe path/pattern ${JSON.stringify(target)}`, () => {
    assert.throws(() => pathDecision(target, scope), { code: "TASK_SCOPE_PATH_INVALID" });
    assert.throws(() => assertTaskScope({ ...scope, allowed_paths: [target] }), { code: "TASK_SCOPE_PATH_INVALID" });
  });
}

for (const values of [undefined, [], "exact.txt", [""], [null], [false], [3]]) {
  test(`invalid allowed metadata ${JSON.stringify(values)}`, () => {
    assert.throws(() => assertTaskScope({ ...scope, allowed_paths: values }));
  });
}
test("forbidden is required and accepts empty arrays", () => {
  for (const value of [undefined, null, "", [false], [""]]) assert.throws(() => assertTaskScope({ ...scope, forbidden_paths: value }));
  assert.doesNotThrow(() => assertTaskScope({ ...scope, forbidden_paths: [] }));
});

test("strict frontmatter preserves rejection evidence while historical parsing remains compatible", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const text of [taskText(), `${taskText().split("\n---\n")[0]}\n---`]) {
      assertTaskScope(parseTaskFrontmatter(text.replaceAll("\n", newline), { strict: true }));
    }
  }
  for (const text of [
    taskText().replace("\n---\n", "\n---INVALID\n"), taskText().replace("\n---\n", "\n"),
    taskText().replace("\n---\n", "\n---INVALID\n---\n"), taskText().replace("status: ACTIVE", "status: ACTIVE\nstatus: ACTIVE"),
    taskText().replace("forbidden_paths: []", "forbidden_paths:\n  - safe"),
    taskText().replace("forbidden_paths: []", "forbidden_paths: []\n__proto__: []\n__proto__: []"),
  ]) assert.throws(() => parseTaskFrontmatter(text, { strict: true }), { code: "TASK_METADATA_INVALID" });
  const old = taskText().replace(/^allowed_paths:.*$/mu, "allowed_paths: []").replace("ACTIVE", "COMPLETED");
  assert.deepEqual(parseTaskFrontmatter(old).allowed_paths, []);
});

test("status parser rejects unsupported, unmerged and truncated observations", () => {
  for (const output of ["?? x", "ZZ x\0", "UU x\0", "DD x\0", "AA x\0", "!! x\0", "   x\0", "?? \0", "R  x\0", "R  x\0\0"]) {
    assert.throws(() => parseGitStatus(output), { code: "GIT_STATUS_INVALID" });
  }
});
test("HEAD diff parser includes rename/copy endpoints and rejects malformed output", () => {
  assert.deepEqual(parseGitDiffPaths("R100\0old\0new\0C90\0source\0copy\0D\0deleted\0A\0added\0"), ["old", "new", "source", "copy", "deleted", "added"]);
  for (const output of ["A\0x", "R100\0old\0", "U\0x\0", "R101\0a\0b\0", "A\0\0", "M\0x\0garbage\0"]) assert.throws(() => parseGitDiffPaths(output), { code: "TASK_SCOPE_GIT_INVALID" });
});
test("Git command errors and malformed HEAD fail closed", () => {
  assert.throws(() => readGitStatus({ execFile: () => { throw new Error("failed"); } }), { code: "TASK_SCOPE_GIT_FAILED" });
  assert.throws(() => readGitHead({ execFile: (_command, args) => args.includes("--show-toplevel") ? process.cwd() : "invalid" }), { code: "TASK_SCOPE_GIT_INVALID" });
});

test("real Git combines staged, unstaged, mixed, untracked, deletion and rename endpoints", async (t) => {
  const root = await fixture(t);
  await put(root, "allowed/staged.txt");
  git(root, ["add", "allowed/staged.txt"]);
  await put(root, "allowed/staged.txt", "mixed\n");
  await put(root, "allowed/file.txt", "unstaged\n");
  await put(root, "allowed/new.txt");
  await rm(path.join(root, "exact.txt"));
  let entries = parseGitStatus(readGitStatus({ repoRoot: root }));
  assert.equal(entries.find((entry) => entry.path === "allowed/staged.txt").status, "AM");
  assert.deepEqual(new Set(readChangedPaths({ repoRoot: root })), new Set(["exact.txt", "allowed/file.txt", "allowed/staged.txt", "allowed/new.txt"]));
  assertChangedPathsAllowed(readChangedPaths({ repoRoot: root }), scope, { repoRoot: root });
  commit(root);
  const startHead = readGitHead({ repoRoot: root });
  git(root, ["mv", "allowed/file.txt", "outside.txt"]);
  entries = parseGitStatus(readGitStatus({ repoRoot: root }));
  assert.ok(entries.some((entry) => entry.status === "R " && entry.from === "allowed/file.txt" && entry.path === "outside.txt"));
  assert.throws(() => assertChangedPathsAllowed(gitChangedPaths(entries), scope, { repoRoot: root }), { code: "TASK_PATH_NOT_ALLOWED" });
  commit(root);
  assert.deepEqual(new Set(readChangedPaths({ repoRoot: root, startHead })), new Set(["allowed/file.txt", "outside.txt"]));
  git(root, ["mv", "outside.txt", "allowed/returned.txt"]);
  assert.throws(() => assertChangedPathsAllowed(readChangedPaths({ repoRoot: root }), scope, { repoRoot: root }), { code: "TASK_PATH_NOT_ALLOWED" });
});

test("unstaged rename observed as delete plus new still checks both ends", async (t) => {
  const root = await fixture(t);
  await rename(path.join(root, "allowed/file.txt"), path.join(root, "outside.txt"));
  const entries = parseGitStatus(readGitStatus({ repoRoot: root }));
  assert.ok(entries.some((entry) => entry.path === "allowed/file.txt" && entry.status === " D"));
  assert.ok(entries.some((entry) => entry.path === "outside.txt" && entry.status === "??"));
  assert.throws(() => assertChangedPathsAllowed(gitChangedPaths(entries), scope, { repoRoot: root }), { code: "TASK_PATH_NOT_ALLOWED" });
});

for (const staged of [false, true]) {
  test(`new and deleted paths retain scope checks; staged=${staged}`, async (t) => {
    const root = await fixture(t);
    await put(root, "outside.txt");
    commit(root);
    await rm(path.join(root, "exact.txt"));
    await rm(path.join(root, "outside.txt"));
    await put(root, "allowed/new.txt", "distinct new content avoids Git rename detection\n");
    if (staged) git(root, ["add", "."]);
    const entries = parseGitStatus(readGitStatus({ repoRoot: root }));
    for (const target of ["exact.txt", "outside.txt"]) {
      assert.equal(entries.find((entry) => entry.path === target).status, staged ? "D " : " D");
    }
    assert.equal(entries.find((entry) => entry.path === "allowed/new.txt").status, staged ? "A " : "??");
    assertChangedPathsAllowed(["exact.txt", "allowed/new.txt"], scope, { repoRoot: root });
    assert.throws(() => assertChangedPathsAllowed(gitChangedPaths(entries), scope, { repoRoot: root }), { code: "TASK_PATH_NOT_ALLOWED" });
  });
}

test("path resolution is based on the supplied repository root and preserves Windows separators", async (t) => {
  const root = await fixture(t);
  assert.equal(resolveScopePath("allowed/file.txt", root), "allowed/file.txt");
  assertChangedPathsAllowed(["allowed/file.txt"], scope, { repoRoot: root });
  if (process.platform === "win32") {
    assert.equal(resolveScopePath("allowed\\file.txt", root), "allowed/file.txt");
    assertChangedPathsAllowed(["allowed\\file.txt"], scope, { repoRoot: root });
  }
});

test("existing and new paths through external junctions/symlinks reject; internal alias cannot bypass forbid", async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(), "study-app-scope-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await put(outside, "existing.txt");
  const kind = process.platform === "win32" ? "junction" : "dir";
  await symlink(outside, path.join(root, "allowed/link"), kind);
  for (const target of ["allowed/link", "allowed/link/existing.txt", "allowed/link/missing/file.txt"]) {
    assert.throws(() => resolveScopePath(target, root), { code: "TASK_SCOPE_PATH_OUTSIDE" });
  }
  await mkdir(path.join(root, "allowed/private"));
  await symlink(path.join(root, "allowed/private"), path.join(root, "allowed/alias"), kind);
  assert.throws(() => assertChangedPathsAllowed(["allowed/alias/new.txt"], scope, { repoRoot: root }), { code: "TASK_PATH_FORBIDDEN" });
  assert.equal(resolveScopePath("allowed/missing/new.txt", root), "allowed/missing/new.txt");
  await rm(path.join(root, "allowed/private"), { recursive: true });
  assert.throws(() => resolveScopePath("allowed/alias/new.txt", root), { code: "TASK_SCOPE_PATH_UNRESOLVED" });
});

for (const staged of [false, true]) {
  test(`completion uses original scope; staged rename=${staged}`, async (t) => {
    const root = await fixture(t);
    await mkdir(path.join(root, "tasks/completed"));
    await rename(path.join(root, ownPaths[0]), path.join(root, ownPaths[1]));
    await put(root, ownPaths[1], taskText().replace("status: ACTIVE", "status: COMPLETED").replace("allowed/**]", "allowed/**, outside.txt]"));
    await writeTaskAnchor(ownPaths[1], root);
    if (staged) git(root, ["add", "tasks"]);
    const entries = parseGitStatus(readGitStatus({ repoRoot: root }));
    if (staged) assert.ok(entries.some((entry) => entry.status === "R " && entry.from === ownPaths[0]));
    const completionTask = await findCompletionTask(entries, root);
    assert.equal(completionTask.id, "TASK-X");
    assert.equal(completionTask.allowed_paths.includes("outside.txt"), false);
    assert.equal(validateGovernance({ changedPaths: gitChangedPaths(entries), completionTask, repoRoot: root }).mode, "TASK_COMPLETION");
    assert.deepEqual(await verifyCompletedTaskAnchors({ repoRoot: root, gitEntries: entries }), { completedTasks: 1, anchors: 1 });
    for (const target of ["outside.txt", "tasks/active/TASK-OTHER.md", "tasks/completed/TASK-OTHER.md", "tasks/anchors/TASK-OTHER.json"]) {
      assert.throws(() => validateGovernance({ changedPaths: [target], completionTask, repoRoot: root }), { code: "TASK_PATH_NOT_ALLOWED" });
    }
  });
}

test("new uncommitted TASK completion with new anchor remains supported", async (t) => {
  const root = await fixture(t);
  await put(root, "tasks/completed/TASK-NEW.md", taskText().replaceAll("TASK-X", "TASK-NEW").replace("status: ACTIVE", "status: COMPLETED"));
  await writeTaskAnchor("tasks/completed/TASK-NEW.md", root);
  const entries = parseGitStatus(readGitStatus({ repoRoot: root }));
  assert.equal((await findCompletionTask(entries, root)).id, "TASK-NEW");
});

test("existing anchor edit is rejected by scope and historical anchor gate", async (t) => {
  const root = await fixture(t);
  await put(root, "tasks/completed/TASK-OLD.md", taskText().replaceAll("TASK-X", "TASK-OLD").replace("status: ACTIVE", "status: COMPLETED"));
  await writeTaskAnchor("tasks/completed/TASK-OLD.md", root);
  commit(root);
  const target = "tasks/anchors/TASK-OLD.json";
  await put(root, target, `${await readFile(path.join(root, target), "utf8")}\n`);
  const entries = parseGitStatus(readGitStatus({ repoRoot: root }));
  assert.throws(() => assertChangedPathsAllowed(gitChangedPaths(entries), { ...scope, allowed_paths: ownPaths }, { repoRoot: root }), { code: "TASK_PATH_NOT_ALLOWED" });
  await assert.rejects(verifyCompletedTaskAnchors({ repoRoot: root, gitEntries: entries }), { code: "TASK_ANCHOR_HISTORY_CHANGED" });
});
