import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCodexArguments,
  loadExecutionProfiles,
  runCodexForProfile,
  selectExecutionProfile,
} from "../scripts/codex-profile.mjs";

const canonicalMappingPath = ".codex/execution-profiles.json";
const profileNames = ["light", "standard", "deep", "review"];

async function temporaryMapping(t, value) {
  const directory = await mkdtemp(join(tmpdir(), "study-app-codex-profile-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "execution-profiles.json");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

test("canonical mappings match the approved TASK-CODEX-004 candidate table", async () => {
  let content;
  try {
    content = await readFile("tasks/active/TASK-CODEX-004.md", "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const anchor = JSON.parse(await readFile("tasks/anchors/TASK-CODEX-004.json", "utf8"));
    content = await readFile(anchor.task_path, "utf8");
  }
  const rows = [...content.replaceAll("\r\n", "\n").matchAll(
    /^\| `(light|standard|deep|review)` \| `([^`]+)` \| `([^`]+)` \|$/gmu,
  )];
  assert.deepEqual(rows.map((row) => row[1]), profileNames);
  const expected = Object.fromEntries(rows.map(([, name, model, reasoning_effort]) => [
    name, { model, reasoning_effort },
  ]));
  assert.deepEqual(loadExecutionProfiles(canonicalMappingPath), expected);
});

test("all canonical execution profiles resolve to their declared CLI overrides", () => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  assert.deepEqual(Object.keys(mapping), profileNames);

  for (const profileName of profileNames) {
    const profile = selectExecutionProfile(mapping, profileName);
    assert.deepEqual(buildCodexArguments(profile), [
      "--model",
      profile.model,
      "--config",
      `model_reasoning_effort="${profile.reasoning_effort}"`,
    ]);
  }
});

test("unknown profiles fail before Codex starts", () => {
  let spawnCount = 0;
  assert.throws(
    () =>
      runCodexForProfile("unknown", [], {
        mappingPath: canonicalMappingPath,
        spawn: () => {
          spawnCount += 1;
          return { status: 0 };
        },
      }),
    /CODEX_PROFILE_UNKNOWN/u,
  );
  assert.equal(spawnCount, 0);
});

test("a missing canonical profile fails before Codex starts", async (t) => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  delete mapping.review;
  const mappingPath = await temporaryMapping(t, mapping);
  let spawnCount = 0;

  assert.throws(
    () =>
      runCodexForProfile("deep", [], {
        mappingPath,
        spawn: () => {
          spawnCount += 1;
          return { status: 0 };
        },
      }),
    /CODEX_PROFILE_MAPPING_INVALID/u,
  );
  assert.equal(spawnCount, 0);
});

test("an invalid reasoning effort fails before Codex starts", async (t) => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  mapping.deep.reasoning_effort = "invalid";
  const mappingPath = await temporaryMapping(t, mapping);
  let spawnCount = 0;

  assert.throws(
    () =>
      runCodexForProfile("deep", [], {
        mappingPath,
        spawn: () => {
          spawnCount += 1;
          return { status: 0 };
        },
      }),
    /CODEX_PROFILE_REASONING_INVALID/u,
  );
  assert.equal(spawnCount, 0);
});

test("an empty model fails before Codex starts", async (t) => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  mapping.light.model = "";
  const mappingPath = await temporaryMapping(t, mapping);
  let spawnCount = 0;

  assert.throws(
    () =>
      runCodexForProfile("light", [], {
        mappingPath,
        spawn: () => {
          spawnCount += 1;
          return { status: 0 };
        },
      }),
    /CODEX_PROFILE_MODEL_INVALID/u,
  );
  assert.equal(spawnCount, 0);
});

for (const model of [null, 42, [], " model", "model ", "two models", "--model"]) {
  test(`malformed model ${JSON.stringify(model)} fails before Codex starts`, async (t) => {
    const mapping = loadExecutionProfiles(canonicalMappingPath);
    mapping.light.model = model;
    const mappingPath = await temporaryMapping(t, mapping);
    let spawns = 0;
    assert.throws(() => runCodexForProfile("light", [], {
      mappingPath,
      spawn: () => { spawns += 1; return { status: 0 }; },
    }), { code: "CODEX_PROFILE_MODEL_INVALID" });
    assert.equal(spawns, 0);
  });
}

test("permission fields in the mapping fail before Codex starts", async (t) => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  mapping.review.sandbox_mode = "read-only";
  const mappingPath = await temporaryMapping(t, mapping);
  let spawnCount = 0;

  assert.throws(
    () =>
      runCodexForProfile("review", [], {
        mappingPath,
        spawn: () => {
          spawnCount += 1;
          return { status: 0 };
        },
      }),
    /CODEX_PROFILE_MAPPING_INVALID/u,
  );
  assert.equal(spawnCount, 0);
});

test("model and reasoning pass-through overrides are rejected", () => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  const profile = selectExecutionProfile(mapping, "standard");

  for (const args of [
    ["--model", "another-model"],
    ["-m", "another-model"],
    ["--config", 'model="another-model"'],
    ["-c", 'model_reasoning_effort="low"'],
  ]) {
    assert.throws(() => buildCodexArguments(profile, args), /CODEX_PROFILE_OVERRIDE_FORBIDDEN/u);
  }
});

for (const override of ['model_reasoning_effort="low"', 'model="another-model"']) {
  for (const args of [
    ["-c", override],
    ["--config", override],
    [`-c${override}`],
    [`-c=${override}`],
    [`--config=${override}`],
  ]) {
    test(`protected config override ${args.join(" ")} fails before Codex starts`, () => {
      let spawnCount = 0;
      assert.throws(
        () => runCodexForProfile("review", args, {
          mappingPath: canonicalMappingPath,
          spawn: () => {
            spawnCount += 1;
            return { status: 0 };
          },
        }),
        { code: "CODEX_PROFILE_OVERRIDE_FORBIDDEN" },
      );
      assert.equal(spawnCount, 0);
    });
  }
}

test("non-protected config overrides retain their arguments and launch once", () => {
  const override = 'model_verbosity="low"';
  for (const args of [
    ["-c", override],
    ["--config", override],
    [`-c${override}`],
    [`-c=${override}`],
    [`--config=${override}`],
  ]) {
    let spawnCount = 0;
    let invocation;
    const status = runCodexForProfile("review", args, {
      mappingPath: canonicalMappingPath,
      spawn: (command, receivedArgs, options) => {
        spawnCount += 1;
        invocation = { command, args: receivedArgs, options };
        return { status: 0 };
      },
    });
    assert.equal(status, 0);
    assert.equal(spawnCount, 1);
    assert.equal(invocation.command, "codex");
    assert.equal(invocation.options.shell, false);
    assert.deepEqual(invocation.args.slice(-args.length), args);
  }
});

test("config-like prompt arguments after the option terminator remain unchanged", () => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  const profile = selectExecutionProfile(mapping, "review");
  const args = ["exec", "--", '-c=model_reasoning_effort="low"'];
  assert.deepEqual(buildCodexArguments(profile, args).slice(-args.length), args);
});

test("launcher passes arguments as a shell-free array on Windows and other platforms", () => {
  const passThrough = ["exec", "--", 'Review this; Write-Output "not executed by a shell"'];
  let invocation;

  const status = runCodexForProfile("review", passThrough, {
    mappingPath: canonicalMappingPath,
    spawn: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(invocation.command, "codex");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.stdio, "inherit");
  assert.deepEqual(invocation.args.slice(-passThrough.length), passThrough);
  assert.doesNotMatch(invocation.args.join("\n"), /sandbox|approval|permission|network/iu);
});

test("canonical model identifiers are not duplicated outside the mapping file", async () => {
  const mapping = loadExecutionProfiles(canonicalMappingPath);
  const modelIdentifiers = new Set(Object.values(mapping).map((profile) => profile.model));
  const taskAnchor = JSON.parse(await readFile("tasks/anchors/TASK-CODEX-001.json", "utf8"));
  const sourcePaths = [
    "scripts/codex-profile.mjs",
    "tests/codex-profile.test.mjs",
    "package.json",
    "AGENTS.md",
    taskAnchor.task_path,
  ];
  const sources = await Promise.all(sourcePaths.map((path) => readFile(path, "utf8")));

  for (const modelIdentifier of modelIdentifiers) {
    for (let index = 0; index < sourcePaths.length; index += 1) {
      assert.equal(
        sources[index].includes(modelIdentifier),
        false,
        `${modelIdentifier} must not be duplicated in ${sourcePaths[index]}`,
      );
    }
  }
});

test("package script delegates to the launcher without embedding mapping values", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.scripts["codex:profile"], "node scripts/codex-profile.mjs");
});
