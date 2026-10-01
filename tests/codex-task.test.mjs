import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCodexForTask } from "../scripts/codex-task.mjs";
import { loadExecutionProfiles } from "../scripts/codex-profile.mjs";
import { parseTaskFrontmatter } from "../scripts/spec/lib.mjs";

const mapping = loadExecutionProfiles();
const manifest = JSON.parse(await readFile("docs/spec-manifest.yaml", "utf8"));

function taskText(profileLine = "execution_profile: deep") {
  return `---\nid: TASK-TEST\nstatus: ACTIVE\nspec_version: ${manifest.spec_version}\nsource_fingerprint: ${manifest.source_fingerprint}\n${profileLine}\nallowed_paths: [tasks/active/TASK-TEST.md, allowed/**]\nforbidden_paths: [allowed/secret.txt]\n---\n\n# Test task\nExecution profile in prose: review\n`;
}

async function fixture(t, content = taskText()) {
  const root = await mkdtemp(join(tmpdir(), "study-app-codex-task-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "tasks/active"), { recursive: true });
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/spec-manifest.yaml"), JSON.stringify(manifest));
  const taskPath = join(root, "tasks/active/TASK-TEST.md");
  await writeFile(taskPath, content);
  git(root, ["init", "--quiet"]);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "baseline"]);
  await mkdir(join(root, "allowed"));
  return { root, taskPath };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function rejectsWithoutSpawn(root, args, code, cwd = root) {
  let spawns = 0;
  await assert.rejects(runCodexForTask(args, {
    repoRoot: root,
    cwd,
    spawn: () => { spawns += 1; return { status: 0 }; },
  }), { code });
  assert.equal(spawns, 0);
}

for (const [label, content, valid] of [
  ["exact line", taskText(), true],
  ["exact line at EOF", taskText().split("\n\n")[0], true],
  ["---INVALID", taskText().replace("\n---\n", "\n---INVALID\n"), false],
  ["extra hyphen", taskText().replace("\n---\n", "\n----\n"), false],
  ["suffix after space", taskText().replace("\n---\n", "\n--- INVALID\n"), false],
  ["missing delimiter", taskText().replace("\n---\n", "\n"), false],
  ["invalid prefix before a later delimiter", taskText().replace("\n---\n", "\n---INVALID\n---\n"), false],
]) {
  test(`frontmatter closing delimiter: ${label}`, async (t) => {
    const { root, taskPath } = await fixture(t);
    const launcherUrl = new URL("../scripts/codex-task.mjs", import.meta.url).href;
    for (const newline of ["\n", "\r\n"]) {
      await writeFile(taskPath, content.replaceAll("\n", newline));
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
        import { runCodexForTask } from ${JSON.stringify(launcherUrl)};
        let spawns = 0;
        try {
          process.exitCode = await runCodexForTask(["TASK-TEST"], {
            repoRoot: process.cwd(), cwd: process.cwd(),
            spawn: () => { spawns += 1; return { status: 0 }; },
          });
        } finally {
          console.log(JSON.stringify({ spawns }));
        }
      `], { cwd: root, encoding: "utf8", shell: false });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, valid ? 0 : 1, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { spawns: valid ? 1 : 0 });
      if (!valid) assert.match(result.stderr, /CODEX_TASK_METADATA_INVALID/u);
    }
  });
}

for (const profileName of Object.keys(mapping)) {
  test(`TASK ${profileName} resolves through the canonical launcher without permission overrides`, async (t) => {
    const { root } = await fixture(t, taskText(`execution_profile: ${profileName}`));
    let spawns = 0;
    const status = await runCodexForTask(["TASK-TEST"], {
      repoRoot: root,
      cwd: root,
      spawn: (command, args, options) => {
        spawns += 1;
        assert.equal(command, "codex");
        assert.deepEqual(args.slice(0, 5), [
          "--model", mapping[profileName].model,
          "--config", `model_reasoning_effort="${mapping[profileName].reasoning_effort}"`, "--",
        ]);
        assert.equal(args.length, 6);
        assert.match(args[5], /tasks\/active\/TASK-TEST\.md/u);
        assert.match(args[5], /allowed_paths/u);
        assert.deepEqual(options, { shell: false, stdio: "inherit", windowsHide: false });
        return { status: 17 };
      },
    });
    assert.equal(status, 17);
    assert.equal(spawns, 1);
  });
}

for (const [label, content, code] of [
  ["missing profile without classification evidence", taskText(""), "CODEX_TASK_PROFILE_UNDETERMINED"],
  ["empty profile", taskText("execution_profile:"), "CODEX_TASK_PROFILE_REQUIRED"],
  ["array profile", taskText("execution_profile: [deep]"), "CODEX_TASK_PROFILE_REQUIRED"],
  ["unknown profile", taskText("execution_profile: unknown"), "CODEX_PROFILE_UNKNOWN"],
  ["duplicate profile", taskText("execution_profile: deep\nexecution_profile: review"), "CODEX_TASK_METADATA_INVALID"],
  ["duplicate identical profile", taskText("execution_profile: deep\nexecution_profile: deep"), "CODEX_TASK_METADATA_INVALID"],
  ["nested metadata", taskText("execution_profile:\n  selected: deep"), "CODEX_TASK_METADATA_INVALID"],
  ["missing frontmatter", "# TASK\nexecution_profile: deep\n", "CODEX_TASK_METADATA_INVALID"],
  ["mismatched id", taskText().replace("id: TASK-TEST", "id: TASK-OTHER"), "CODEX_TASK_METADATA_INVALID"],
  ["completed status", taskText().replace("status: ACTIVE", "status: COMPLETED"), "CODEX_TASK_METADATA_INVALID"],
  ["duplicate status", taskText("execution_profile: deep\nstatus: ACTIVE"), "CODEX_TASK_METADATA_INVALID"],
  ["stale spec version", taskText().replace(manifest.spec_version, "2000.01.01-v1"), "TASK_SPEC_VERSION_MISMATCH"],
  ["stale fingerprint", taskText().replace(manifest.source_fingerprint, `sha256:${"0".repeat(64)}`), "TASK_SOURCE_FINGERPRINT_MISMATCH"],
]) {
  test(`${label} rejects before Codex starts`, async (t) => {
    const { root } = await fixture(t, content);
    await rejectsWithoutSpawn(root, ["TASK-TEST"], code);
  });
}

test("TASK selection is reread at each launch and body text is never its source", async (t) => {
  const { root, taskPath } = await fixture(t);
  for (const profileName of ["light", "deep"]) {
    await writeFile(taskPath, taskText(`execution_profile: ${profileName}`).replaceAll("\n", "\r\n"));
    let spawns = 0;
    await runCodexForTask(["TASK-TEST"], {
      repoRoot: root, cwd: root,
      spawn: (_command, args) => {
        spawns += 1;
        assert.equal(args[1], mapping[profileName].model);
        assert.equal(args[3], `model_reasoning_effort="${mapping[profileName].reasoning_effort}"`);
        return { status: 0 };
      },
    });
    assert.equal(spawns, 1);
  }
});

test("TASK-CODEX-004 selects its canonical profile from frontmatter", async (t) => {
  let content;
  try {
    content = await readFile("tasks/active/TASK-CODEX-004.md", "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const anchor = JSON.parse(await readFile("tasks/anchors/TASK-CODEX-004.json", "utf8"));
    content = await readFile(anchor.task_path, "utf8");
  }
  const task = parseTaskFrontmatter(content, { strict: true });
  assert.equal(task.execution_profile, "deep");
  const { root } = await fixture(t, taskText(`execution_profile: ${task.execution_profile}`));
  let spawns = 0;
  assert.equal(await runCodexForTask(["TASK-TEST"], {
    repoRoot: root, cwd: root,
    spawn: (_command, args) => {
      spawns += 1;
      assert.deepEqual(args.slice(0, 4), [
        "--model", mapping[task.execution_profile].model,
        "--config", `model_reasoning_effort="${mapping[task.execution_profile].reasoning_effort}"`,
      ]);
      return { status: 0 };
    },
  }), 0);
  assert.equal(spawns, 1);
});

test("CLI has only a TASK id, rejecting profile overrides, extra prompts, flags and paths", async (t) => {
  const { root } = await fixture(t);
  for (const args of [
    [], ["../TASK-TEST"], ["tasks/active/TASK-TEST.md"], ["TASK-TEST.md"], ["TASK-TEST;whoami"],
    ["TASK-TEST", "review"], ["TASK-TEST", "--profile", "review"], ["TASK-TEST", "-pdeep"],
    ["TASK-TEST", "--model", "another-model"], ["TASK-TEST", "--", "another prompt"],
    ["TASK-TEST", "exec"], ["TASK-TEST", "--help"],
    ["TASK-TEST", "-C", ".."], ["TASK-TEST", "--sandbox", "read-only"],
  ]) {
    await rejectsWithoutSpawn(root, args, "CODEX_TASK_USAGE");
  }
  for (const key of ["model", "model_reasoning_effort"]) {
    const override = `${key}="${mapping.deep[key === "model" ? "model" : "reasoning_effort"]}"`;
    for (const flags of [["-c", override], ["--config", override], [`-c${override}`], [`-c=${override}`], [`--config=${override}`]]) {
      await rejectsWithoutSpawn(root, ["TASK-TEST", ...flags], "CODEX_TASK_USAGE");
    }
  }
});

test("requested TASK must be the single active TASK", async (t) => {
  const { root, taskPath } = await fixture(t);
  await rejectsWithoutSpawn(root, ["TASK-OTHER"], "CODEX_TASK_ACTIVE_MISMATCH");
  await writeFile(join(root, "tasks/active/TASK-OTHER.md"), taskText());
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "CODEX_TASK_ACTIVE_MISMATCH");
  await rm(taskPath);
  await rm(join(root, "tasks/active/TASK-OTHER.md"));
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "CODEX_TASK_ACTIVE_MISMATCH");
});

test("wrong working directory rejects before launch", async (t) => {
  const { root } = await fixture(t);
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "CODEX_TASK_CWD_INVALID", join(root, "docs"));
});

test("a linked active directory rejects before launch", async (t) => {
  const { root, taskPath } = await fixture(t);
  const alternate = join(root, "alternate");
  await mkdir(alternate);
  await writeFile(join(alternate, "TASK-TEST.md"), taskText());
  await rm(taskPath);
  await rm(join(root, "tasks/active"), { recursive: true });
  await symlink(alternate, join(root, "tasks/active"), process.platform === "win32" ? "junction" : "dir");
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "CODEX_TASK_PATH_INVALID");
});

test("missing manifest and process startup errors fail without masking the failure", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(runCodexForTask(["TASK-TEST"], {
    repoRoot: root, cwd: root, spawn: () => ({ error: new Error("unavailable") }),
  }), { code: "CODEX_PROFILE_LAUNCH_FAILED" });
  await rm(join(root, "docs/spec-manifest.yaml"));
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "ENOENT");
});

test("current TASK, package and new files retain a single mapping source", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.scripts["codex:task"], "node scripts/codex-task.mjs");
  assert.equal(packageJson.scripts["codex:profile"], "node scripts/codex-profile.mjs");
  let taskPath = "tasks/active/TASK-CODEX-002.md";
  let content;
  try {
    content = await readFile(taskPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const anchor = JSON.parse(await readFile("tasks/anchors/TASK-CODEX-002.json", "utf8"));
    taskPath = anchor.task_path;
    content = await readFile(taskPath, "utf8");
  }
  assert.equal(parseTaskFrontmatter(content).execution_profile, "deep");
  const sourcePaths = ["scripts/codex-task.mjs", "tests/codex-task.test.mjs", "docs/codex-task.md", "AGENTS.md", "package.json", taskPath];
  for (const file of sourcePaths) {
    const source = await readFile(file, "utf8");
    for (const profile of Object.values(mapping)) {
      assert.equal(source.includes(profile.model), false, `${file} must not duplicate a model`);
      assert.equal(new RegExp(`(?<![a-z_-])${profile.reasoning_effort}(?![a-z_-])`, "u").test(source), false, `${file} must not duplicate an effort value`);
    }
  }
  if (parseTaskFrontmatter(content).status !== "ACTIVE") return;
  let spawns = 0;
  await runCodexForTask(["TASK-CODEX-002"], {
    cwd: resolve("."),
    spawn: (_command, args) => {
      spawns += 1;
      assert.equal(args[1], mapping.deep.model);
      assert.equal(args[3], `model_reasoning_effort="${mapping.deep.reasoning_effort}"`);
      assert.match(args[5], /tasks\/active\/TASK-CODEX-002\.md/u);
      return { status: 0 };
    },
  });
  assert.equal(spawns, 1);
});

for (const target of ["outside.txt", "allowed/secret.txt"]) {
  test(`preflight ${target} rejects with spawn 0`, async (t) => {
    const { root } = await fixture(t);
    await writeFile(join(root, target), "violation");
    await rejectsWithoutSpawn(root, ["TASK-TEST"], target.startsWith("allowed/") ? "TASK_PATH_FORBIDDEN" : "TASK_PATH_NOT_ALLOWED");
  });
}

for (const [label, replacement] of [
  ...[1, 2, 3].map((indent) => [`child heading indented ${indent} spaces`, `${" ".repeat(indent)}### Example\nIntent: maintenance`]),
  ["second HTML comment continuing onto following lines", "<!-- first --> <!-- second\nIntent: maintenance\n-->"],
]) {
  test(`auto ignores ${label} and exits nonzero with spawn 0`, async (t) => {
    const { root } = await fixture(t, autoTask().replace("Intent: maintenance", replacement));
    const launcherUrl = new URL("../scripts/codex-task.mjs", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { runCodexForTask } from ${JSON.stringify(launcherUrl)};
      let spawns = 0;
      try {
        process.exitCode = await runCodexForTask(["TASK-TEST"], {
          repoRoot: process.cwd(), cwd: process.cwd(),
          spawn: () => { spawns++; return { status: 0 }; },
        });
      } finally { console.log(JSON.stringify({ spawns })); }
    `], { cwd: root, encoding: "utf8", shell: false });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { spawns: 0 });
    assert.match(result.stderr, /CODEX_TASK_PROFILE_UNDETERMINED/u);
  });
}

for (const [label, edit, code] of [
  ["missing allowed", (s) => s.replace(/^allowed_paths:.*\n/mu, ""), "TASK_SCOPE_METADATA_INVALID"],
  ["empty allowed", (s) => s.replace(/^allowed_paths:.*$/mu, "allowed_paths: []"), "TASK_SCOPE_METADATA_INVALID"],
  ["missing forbidden", (s) => s.replace(/^forbidden_paths:.*\n/mu, ""), "TASK_SCOPE_METADATA_INVALID"],
  ["scalar scope", (s) => s.replace(/^allowed_paths:.*$/mu, "allowed_paths: allowed"), "TASK_SCOPE_METADATA_INVALID"],
  ["duplicate scope", (s) => s.replace("forbidden_paths:", "allowed_paths: [outside.txt]\nforbidden_paths:"), "CODEX_TASK_METADATA_INVALID"],
  ["traversal pattern", (s) => s.replace("allowed/**", "allowed/../**"), "TASK_SCOPE_PATH_INVALID"],
]) {
  test(`scope metadata ${label} fails before spawn`, async (t) => {
    const { root } = await fixture(t, edit(taskText()));
    await rejectsWithoutSpawn(root, ["TASK-TEST"], code);
  });
}

test("ordinary untracked allowed file launches exactly once", async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, "allowed/new.txt"), "allowed");
  let spawns = 0;
  assert.equal(await runCodexForTask(["TASK-TEST"], {
    repoRoot: root, cwd: root, spawn: () => { spawns += 1; return { status: 0 }; },
  }), 0);
  assert.equal(spawns, 1);
});

for (const [pattern, target] of [["allowed/*.txt", "allowed/new.txt"], ["allowed/**", "allowed/new.txt"], ["23", "23"], ["allowed\\*.txt", "allowed/new.txt"]]) {
  test(`launcher preserves scope pattern ${pattern} and legacy empty-element parsing`, async (t) => {
    const text = taskText().replace("allowed/**]", `${pattern},, ]`);
    const { root } = await fixture(t, text);
    await writeFile(join(root, target), "allowed");
    let spawns = 0;
    const run = runCodexForTask(["TASK-TEST"], {
      repoRoot: root, cwd: root, spawn: () => { spawns += 1; return { status: 0 }; },
    });
    if (pattern.includes("\\") && process.platform !== "win32") {
      await assert.rejects(run, { code: "TASK_PATH_NOT_ALLOWED" });
      assert.equal(spawns, 0);
    } else {
      assert.equal(await run, 0);
      assert.equal(spawns, 1);
    }
  });
}

for (const phase of ["allowed", "preflight", "postflight"]) {
  test(`real process ${phase} exit status and Codex spawn count`, async (t) => {
    const { root } = await fixture(t);
    if (phase === "preflight") await writeFile(join(root, "outside.txt"), "violation");
    const launcherUrl = new URL("../scripts/codex-task.mjs", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { writeFileSync } from "node:fs";
      import { runCodexForTask } from ${JSON.stringify(launcherUrl)};
      let spawns = 0;
      let code;
      try {
        process.exitCode = await runCodexForTask(["TASK-TEST"], {
          repoRoot: process.cwd(), cwd: process.cwd(),
          spawn: () => {
            spawns += 1;
            writeFileSync(${JSON.stringify(phase === "postflight" ? "outside.txt" : "allowed/new.txt")}, "child");
            return { status: 0 };
          },
        });
      } catch (error) { code = error.code; process.exitCode = 1; }
      console.log(JSON.stringify({ spawns, code }));
    `], { cwd: root, encoding: "utf8", shell: false });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, phase === "allowed" ? 0 : 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), phase === "allowed"
      ? { spawns: 1 } : { spawns: phase === "preflight" ? 0 : 1, code: "TASK_PATH_NOT_ALLOWED" });
  });
}

for (const expand of [false, true]) {
  test(`child exit 0 with postflight violation rejects; scope expansion=${expand}`, async (t) => {
    const { root, taskPath } = await fixture(t);
    let spawns = 0;
    await assert.rejects(runCodexForTask(["TASK-TEST"], {
      repoRoot: root, cwd: root,
      spawn: () => {
        spawns += 1;
        if (expand) writeFileSync(taskPath, taskText().replace("allowed/**]", "allowed/**, outside.txt]"));
        writeFileSync(join(root, "outside.txt"), "violation");
        return { status: 0 };
      },
    }), (error) => error.code === "TASK_PATH_NOT_ALLOWED" && error.actual.includes("postflight (child 0)"));
    assert.equal(spawns, 1);
  });
}

for (const allowed of [false, true]) {
  test(`start HEAD to end HEAD checks committed ${allowed ? "allowed" : "outside"} path`, async (t) => {
    const { root } = await fixture(t);
    const run = runCodexForTask(["TASK-TEST"], {
      repoRoot: root, cwd: root,
      spawn: () => {
        writeFileSync(join(root, allowed ? "allowed/new.txt" : "outside.txt"), "committed");
        git(root, ["add", "."]);
        git(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "child"]);
        assert.equal(git(root, ["status", "--porcelain"]), "");
        return { status: 0 };
      },
    });
    if (allowed) assert.equal(await run, 0);
    else await assert.rejects(run, { code: "TASK_PATH_NOT_ALLOWED" });
  });
}

test("Git read failure rejects preflight with spawn 0", async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, ".git/HEAD"), "invalid HEAD\n");
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "TASK_SCOPE_GIT_FAILED");
});

test("Git read failure after child success rejects postflight", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(runCodexForTask(["TASK-TEST"], {
    repoRoot: root, cwd: root,
    spawn: () => { writeFileSync(join(root, ".git/HEAD"), "invalid HEAD\n"); return { status: 0 }; },
  }), { code: "TASK_SCOPE_GIT_FAILED" });
});

test("moving TASK during child execution preserves the startup scope", async (t) => {
  const content = taskText().replace("allowed/**]", "allowed/**, tasks/completed/TASK-TEST.md]");
  const { root, taskPath } = await fixture(t, content);
  let spawns = 0;
  assert.equal(await runCodexForTask(["TASK-TEST"], {
    repoRoot: root, cwd: root,
    spawn: () => {
      spawns += 1;
      mkdirSync(join(root, "tasks/completed"));
      renameSync(taskPath, join(root, "tasks/completed/TASK-TEST.md"));
      writeFileSync(join(root, "tasks/completed/TASK-TEST.md"), content.replace("ACTIVE", "COMPLETED"));
      return { status: 0 };
    },
  }), 0);
  assert.equal(spawns, 1);
});

test("child signal retains the existing launch failure", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(runCodexForTask(["TASK-TEST"], {
    repoRoot: root, cwd: root, spawn: () => ({ status: null, signal: "SIGTERM" }),
  }), { code: "CODEX_PROFILE_LAUNCH_FAILED" });
});

function autoTask({ change = "typo", risk = "none", intent = "maintenance", target = "allowed/note.md" } = {}) {
  return taskText("").replace("allowed/**", target)
    .replace("\n---\n", `\nacceptance_criteria: [AC-1]\nchange_targets: [${target}]\n---\n`)
    .replace("# Test task\nExecution profile in prose: review", `## Goal\nIntent: ${intent}\nBounded work; review word alone is not a review intent.\n\n## Acceptance Criteria\n- [ ] AC-1: [change:${change}] [risk:${risk}] Complete the specified work.`);
}

for (const [profile, options] of [
  ["light", {}], ["standard", { intent: "implementation", change: "feature" }],
  ["deep", { intent: "implementation", change: "feature", risk: "security" }],
  ["review", { intent: "independent-review", change: "completion-review", target: "docs/reviews/report.md" }],
]) {
  test(`auto ${profile} reaches the canonical launcher, preserves TASK and returns child status`, async (t) => {
    const content = autoTask(options);
    const { root, taskPath } = await fixture(t, content);
    let spawns = 0;
    assert.equal(await runCodexForTask(["TASK-TEST"], {
      repoRoot: root, cwd: root, spawn: (_cmd, args) => {
        spawns++;
        assert.equal(args[1], mapping[profile].model);
        assert.equal(args[3], `model_reasoning_effort="${mapping[profile].reasoning_effort}"`);
        assert.match(args[5], /stop and relaunch/u);
        return { status: 17 };
      },
    }), 17);
    assert.equal(spawns, 1);
    assert.equal(await readFile(taskPath, "utf8"), content);
  });
}

for (const [label, edit, code] of [
  ["blank explicit", (s) => s.replace("status: ACTIVE", "status: ACTIVE\nexecution_profile:   "), "CODEX_TASK_PROFILE_REQUIRED"],
  ["array explicit", (s) => s.replace("status: ACTIVE", "status: ACTIVE\nexecution_profile: [light]"), "CODEX_TASK_PROFILE_REQUIRED"],
  ["unknown explicit", (s) => s.replace("status: ACTIVE", "status: ACTIVE\nexecution_profile: auto"), "CODEX_PROFILE_UNKNOWN"],
  ["numeric explicit", (s) => s.replace("status: ACTIVE", "status: ACTIVE\nexecution_profile: 12"), "CODEX_PROFILE_UNKNOWN"],
  ["duplicate explicit", (s) => s.replace("status: ACTIVE", "status: ACTIVE\nexecution_profile: light\nexecution_profile: light"), "CODEX_TASK_METADATA_INVALID"],
  ["malformed frontmatter", (s) => s.replace("\n---\n", "\n---INVALID\n"), "CODEX_TASK_METADATA_INVALID"],
  ["ambiguous goal", (s) => s.replace("Intent: maintenance", "Intent: unknown"), "CODEX_TASK_PROFILE_UNDETERMINED"],
  ["stale fingerprint", (s) => s.replace(manifest.source_fingerprint, `sha256:${"0".repeat(64)}`), "TASK_SOURCE_FINGERPRINT_MISMATCH"],
  ["stale spec", (s) => s.replace(manifest.spec_version, "2000.01.01-v1"), "TASK_SPEC_VERSION_MISMATCH"],
]) {
  test(`auto-capable TASK still rejects ${label} without spawning`, async (t) => {
    const { root } = await fixture(t, edit(autoTask()));
    await rejectsWithoutSpawn(root, ["TASK-TEST"], code);
  });
}

test("auto preflight and CLI overrides cannot bypass scope or double-selection rejection", async (t) => {
  const { root } = await fixture(t, autoTask());
  for (const args of [["TASK-TEST", "light"], ["TASK-TEST", "--model", "other"], ["TASK-TEST", "--config", "model_reasoning_effort=other"]]) {
    await rejectsWithoutSpawn(root, args, "CODEX_TASK_USAGE");
  }
  await writeFile(join(root, "allowed/secret.txt"), "forbidden");
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "TASK_PATH_FORBIDDEN");
});

for (const committed of [false, true]) {
  test(`auto postflight retains startup scope across TASK edits and HEAD changes; commit=${committed}`, async (t) => {
    const { root, taskPath } = await fixture(t, autoTask());
    let spawns = 0;
    await assert.rejects(runCodexForTask(["TASK-TEST"], {
      repoRoot: root, cwd: root, spawn: () => {
        spawns++;
        writeFileSync(taskPath, autoTask().replace("allowed/note.md]", "allowed/note.md, outside.txt]"));
        writeFileSync(join(root, "outside.txt"), "violation");
        if (committed) {
          git(root, ["add", "."]);
          git(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "child"]);
        }
        return { status: 0 };
      },
    }), (error) => error.code === "TASK_PATH_NOT_ALLOWED" && error.actual.includes("postflight (child 0)"));
    assert.equal(spawns, 1);
  });
}

test("auto preflight observes both rename endpoints", async (t) => {
  const { root } = await fixture(t, autoTask());
  await writeFile(join(root, "outside.txt"), "source");
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "source"]);
  git(root, ["mv", "outside.txt", "allowed/note.md"]);
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "TASK_PATH_NOT_ALLOWED");
});

test("auto rejects external junctions and cannot conceal risk behind an internal alias", async (t) => {
  const { root } = await fixture(t, autoTask({ target: "allowed/alias/note.md" }));
  const external = await mkdtemp(join(tmpdir(), "codex-auto-external-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  const alias = join(root, "allowed/alias");
  await symlink(external, alias, process.platform === "win32" ? "junction" : "dir");
  await rejectsWithoutSpawn(root, ["TASK-TEST"], "TASK_SCOPE_PATH_OUTSIDE");
  await rm(alias);
  await mkdir(join(root, "scripts/spec"), { recursive: true });
  await writeFile(join(root, "scripts/spec/note.md"), "baseline");
  await symlink(join(root, "scripts/spec"), alias, process.platform === "win32" ? "junction" : "dir");
  // Include the link itself in the fixture baseline. Only regular paths are
  // possible future changes; neither the alias nor its target may hide risk.
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "alias"]);
  const content = autoTask({ target: "allowed/alias/note.md, scripts/spec/note.md" });
  await writeFile(join(root, "tasks/active/TASK-TEST.md"), content);
  let profile;
  assert.equal(await runCodexForTask(["TASK-TEST"], { repoRoot: root, cwd: root, spawn: (_cmd, args) => {
    profile = args[1]; return { status: 0 };
  } }), 0);
  assert.equal(profile, mapping.deep.model);
});

for (const failure of ["throw", "unknown"]) {
  test(`selector ${failure} fails closed and never spawns`, async (t) => {
    const { root } = await fixture(t, autoTask());
    const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "--eval", `
      import { mock } from "node:test";
      mock.module(${JSON.stringify(new URL("../scripts/codex-profile-selection.mjs", import.meta.url).href)}, {
        namedExports: { selectTaskExecutionProfile() { ${failure === "throw" ? 'throw new Error("internal error");' : 'return { selected_profile: "unsupported" };'} } },
      });
      const { runCodexForTask } = await import(${JSON.stringify(new URL("../scripts/codex-task.mjs", import.meta.url).href)});
      let spawns = 0;
      try { await runCodexForTask(["TASK-TEST"], { repoRoot: process.cwd(), cwd: process.cwd(), spawn() { spawns++; return { status: 0 }; } }); }
      catch (error) { console.log(JSON.stringify({ code: error.code, spawns })); }
    `], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { code: "CODEX_TASK_PROFILE_SELECTION_FAILED", spawns: 0 });
  });
}

test("selection output is machine-readable on stderr for both sources", async (t) => {
  const { root, taskPath } = await fixture(t, autoTask());
  for (const source of ["auto", "explicit"]) {
    if (source === "explicit") await writeFile(taskPath, taskText("execution_profile: light"));
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { runCodexForTask } from ${JSON.stringify(new URL("../scripts/codex-task.mjs", import.meta.url).href)};
      process.exitCode = await runCodexForTask(["TASK-TEST"], { repoRoot: process.cwd(), cwd: process.cwd(), spawn: () => ({ status: 0 }) });
    `], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    const selection = JSON.parse(result.stderr);
    assert.equal(selection.selected_profile, "light");
    assert.equal(selection.selection_source, source);
    assert.ok(selection.selection_reason);
    assert.ok(selection.reason_codes.length);
  }
});
