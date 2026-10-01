import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { selectTaskExecutionProfile as select } from "../scripts/codex-profile-selection.mjs";
import { loadExecutionProfiles, runCodexForProfile } from "../scripts/codex-profile.mjs";
import { parseTaskFrontmatter } from "../scripts/spec/lib.mjs";

function example({ intent = "maintenance", changes = ["typo"], risks = "none", targets = ["docs/security.md"], extra = "", description = "Fix security documentation typo; no behavior change." } = {}) {
  const acs = changes.map((_, i) => `AC-${i + 1}`);
  const content = `---\nid: TASK-TEST\nstatus: ACTIVE\nacceptance_criteria: [${acs}]\nallowed_paths: [tasks/active/TASK-TEST.md, tasks/completed/TASK-TEST.md, tasks/anchors/TASK-TEST.json${targets.length ? `, ${targets}` : ""}]\nforbidden_paths: [private/**]\nchange_targets: [${targets}]\n${extra}---\n\n## Goal\nIntent: ${intent}\n${description}\n\n## Acceptance Criteria\n${changes.map((change, i) => `- [ ] ${acs[i]}: [change:${change}] [risk:${risks}] ${description}`).join("\n")}\n`;
  return { task: parseTaskFrontmatter(content, { strict: true }), content };
}

function decide(options) {
  const { task, content } = example(options);
  return select(task, content);
}

for (const profile of ["light", "standard", "deep", "review"]) {
  test(`explicit ${profile} ignores conflicting or absent auto evidence`, () => {
    const { task } = example({ extra: `execution_profile: ${profile}\n`, changes: ["security"], targets: ["scripts/spec/check.mjs"] });
    assert.equal(select(task, null).selected_profile, profile);
    assert.equal(select(task, null).selection_source, "explicit");
  });
}

for (const value of ["", " ", [], null, false, 0, "unknown", "deep ", "auto"]) {
  test(`invalid explicit is not auto: ${JSON.stringify(value)}`, () => {
    const { task, content } = example();
    task.execution_profile = value;
    assert.throws(() => select(task, content), { code: typeof value === "string" && value.trim() ? "CODEX_PROFILE_UNKNOWN" : "CODEX_TASK_PROFILE_REQUIRED" });
  });
}

for (const change of ["typo", "wording", "comment", "documentation"]) {
  test(`local non-behavioral ${change} selects light`, () => {
    assert.equal(decide({ changes: [change] }).selected_profile, "light");
  });
}
for (const change of ["feature", "bugfix", "test", "refactor"]) {
  test(`bounded ${change} selects standard despite review word in prose`, () => {
    assert.equal(decide({ intent: "implementation", changes: [change], targets: ["src/domain/study/a.ts", "src/domain/study/b.ts"], description: "Implement and ask for review later." }).selected_profile, "standard");
  });
}
for (const risk of ["architecture", "security", "specification", "governance", "scope-guard", "destructive-operation", "complex-bug", "cross-feature", "cross-layer", "migration", "concurrency", "authentication", "authorization", "execution-infrastructure", "repository-wide"]) {
  test(`one target with risk ${risk} escalates even alongside typo`, () => {
    const selection = decide({ changes: ["typo"], risks: risk });
    assert.equal(selection.selected_profile, "deep");
    assert.ok(selection.reason_codes.includes(`risk:${risk}`));
    assert.equal(decide({ changes: [risk], intent: "implementation" }).selected_profile, "deep");
  });
}
for (const target of ["scripts/spec/check.mjs", "scripts/codex-task.mjs", ".codex/execution-profiles.json", "docs/product-specs/development-rules.md", "src/application/auth/login.ts", "drizzle/0001.sql", "AGENTS.md"]) {
  test(`sensitive target ${target} escalates despite risk:none`, () => {
    assert.equal(decide({ targets: [target] }).selected_profile, "deep");
  });
}
for (const change of ["completion-review", "formal-review", "final-verification", "architecture-review", "security-review"]) {
  test(`independent ${change} selects review even with security risk`, () => {
    assert.equal(decide({ intent: "independent-review", changes: [change], risks: "security", targets: ["docs/reviews/report.md"] }).selected_profile, "review");
  });
}
test("independent review may only update its TASK; mixed implementation escalates to deep", () => {
  assert.equal(decide({ intent: "independent-review", changes: ["completion-review"], targets: [] }).selected_profile, "review");
  const selection = decide({ intent: "implementation-and-review", changes: ["feature", "completion-review"] });
  assert.equal(selection.selected_profile, "deep");
  assert.ok(selection.reason_codes.includes("risk:independent-review-required"));
});

for (const [count, expected] of [[2, "light"], [3, "light"], [4, "standard"], [9, "standard"], [10, "standard"], [11, "deep"]]) {
  test(`exact target threshold ${count} selects ${expected}`, () => {
    assert.equal(decide({ targets: Array.from({ length: count }, (_, i) => `docs/new-${i}.md`) }).selected_profile, expected);
  });
}
test("distinct layers or feature directories escalate, sibling files do not", () => {
  for (const targets of [["src/domain/study/a.ts", "src/application/study/b.ts"], ["src/domain/study/a.ts", "src/domain/exam/b.ts"]]) {
    assert.equal(decide({ intent: "implementation", changes: ["feature"], targets }).selected_profile, "deep");
  }
});

test("same snapshot, order and newline variations produce identical complete reasons", () => {
  const { task, content } = example({ changes: ["typo", "comment"], risks: "security,architecture", targets: ["docs/b.md", "docs/a.md"] });
  const expected = select(task, content);
  for (let i = 0; i < 10; i++) assert.deepEqual(select(task, content), expected);
  const reversed = { ...task, allowed_paths: [...task.allowed_paths].reverse(), change_targets: [...task.change_targets].reverse(), acceptance_criteria: [...task.acceptance_criteria].reverse() };
  assert.deepEqual(select(reversed, content.replaceAll("\n", "\r\n").replaceAll("security,architecture", "architecture,security")), expected);
  assert.equal(expected.selection_source, "auto");
  assert.match(expected.selection_reason, /Acceptance Criteria\/AC-1/u);
  assert.match(expected.selection_reason, /target|targets/u);
  assert.deepEqual(Object.keys(expected).sort(), ["reason_codes", "selected_profile", "selection_reason", "selection_source"]);
});

test("quoted, fenced, example and excluded risk words do not supply evidence", () => {
  const { task, content } = example();
  const suffix = "\n## Out of Scope\nsecurity migration architecture review\nIntent: independent-review\n\n```md\n## Goal\nIntent: independent-review\n```\n> Intent: independent-review\n";
  assert.deepEqual(select(task, content + suffix), select(task, content));
  assert.deepEqual(select(task, `${content}\n~~~md\n<!-- an example comment\n~~~\n`), select(task, content));
  for (const replacement of ["> Intent: maintenance", "```md\nIntent: maintenance\n```", "Do not use Intent: maintenance", "<!--\nIntent: maintenance\n-->", "### Example\nIntent: maintenance"]) {
    assert.throws(() => select(task, content.replace("Intent: maintenance", replacement)), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
  }
});

for (const indent of [0, 1, 2, 3]) {
  for (const level of [3, 4, 5, 6]) {
    test(`child heading with ${indent} spaces and level ${level} cannot supply Intent or AC`, () => {
      const { task, content } = example();
      const heading = `${" ".repeat(indent)}${"#".repeat(level)}\tExample`;
      for (const marker of ["Intent: maintenance", "- [ ] AC-1:"]) {
        assert.throws(() => select(task, content.replace(marker, `${heading}\n${marker}`)), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
      }
      const withExamples = content.replace("\n## Acceptance Criteria", `\n${heading}\nIntent: independent-review\n## Acceptance Criteria`)
        + `\n${heading}\n- [ ] AC-2: [change:security] [risk:security] Example only.\n`;
      assert.deepEqual(select(task, withExamples), select(task, content));
    });
  }
}

test("indented top-level sections and empty child headings retain section boundaries", () => {
  const { task, content } = example();
  assert.deepEqual(select(task, content.replaceAll("\n## ", "\n   ## ")), select(task, content));
  assert.throws(() => select(task, content.replace("Intent: maintenance", "   ###\nIntent: maintenance")), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
});

for (const opening of ["<!-- first --> <!-- second", "<!-- first --><!-- second --><!-- third", "<!-- first\n--> <!-- second"]) {
  test(`all comment delimiters are consumed in order: ${JSON.stringify(opening)}`, () => {
    const { task, content } = example();
    const hidden = `${opening}\nIntent: maintenance\n-->`;
    assert.throws(() => select(task, content.replace("Intent: maintenance", hidden)), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
    const comments = `${opening}\nIntent: independent-review\n## Goal\n~~~md\n-->\n`;
    assert.deepEqual(select(task, content.replace("Intent: maintenance", `${comments}Intent: maintenance`)), select(task, content));
    assert.throws(() => select(task, `${content}\n${opening}\nIntent: maintenance`), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
  });
}

test("multiple closed inline comments keep the existing whole-line exclusion contract", () => {
  const { task, content } = example();
  const comments = "<!-- one --> <!-- Intent: independent-review --> <!-- three -->\n";
  assert.deepEqual(select(task, content.replace("Intent: maintenance", `${comments}Intent: maintenance`)), select(task, content));
});

for (const [label, edit] of [
  ["no evidence", () => "# Unknown TASK"],
  ["missing intent", (s) => s.replace("Intent: maintenance", "")],
  ["duplicate intent", (s) => s.replace("Intent: maintenance", "Intent: maintenance\nIntent: implementation")],
  ["unknown intent", (s) => s.replace("Intent: maintenance", "Intent: maybe")],
  ["missing risk", (s) => s.replace("[risk:none] ", "")],
  ["unknown risk", (s) => s.replace("risk:none", "risk:uncertain")],
  ["contradictory risks", (s) => s.replace("risk:none", "risk:none,security")],
  ["duplicated risk", (s) => s.replace("risk:none", "risk:security,security")],
  ["extra marker", (s) => s.replaceAll("Fix security", "[change:feature] Fix security")],
  ["unknown change", (s) => s.replace("change:typo", "change:unknown")],
  ["missing AC", (s) => s.replace(/^- \[ \].*$/mu, "")],
  ["unknown AC", (s) => s.replace("AC-1:", "AC-2:")],
  ["duplicate Goal", (s) => `${s}\n## Goal\nIntent: maintenance\n`],
  ["unclosed fence", (s) => `${s}\n~~~md\n`],
]) {
  test(`insufficient/ambiguous content refuses: ${label}`, () => {
    const { task, content } = example();
    assert.throws(() => select(task, edit(content)), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
  });
}

for (const options of [
  { intent: "independent-review", changes: ["feature"] },
  { intent: "independent-review", changes: ["completion-review"], targets: ["src/domain/a.ts"] },
  { intent: "implementation", changes: ["completion-review"] },
  { intent: "implementation-and-review", changes: ["feature"] },
  { intent: "maintenance", changes: ["feature"] },
  { intent: "investigation" },
  { targets: [] },
]) {
  test(`intent and work must agree: ${JSON.stringify(options)}`, () => {
    assert.throws(() => decide(options), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
  });
}

test("scope must be exact, complete and forbidden-first, regardless of current files", () => {
  const { task, content } = example();
  for (const patch of [
    { change_targets: undefined }, { change_targets: "docs/security.md" },
    { change_targets: ["docs/*.md"] }, { change_targets: [] },
    { change_targets: ["docs/security.md", "docs/security.md"] },
    { allowed_paths: [...task.allowed_paths, "src/**"] },
    { allowed_paths: [...task.allowed_paths, "src/new.ts"] },
    { forbidden_paths: ["docs/**"] }, { change_targets: ["private/key.txt"] },
  ]) assert.throws(() => select({ ...task, ...patch }, content), { code: "CODEX_TASK_PROFILE_UNDETERMINED" });
  const excluded = { ...task, allowed_paths: [...task.allowed_paths, "security/**"], forbidden_paths: ["security/**"] };
  assert.equal(select(excluded, content).selected_profile, "light");
  assert.throws(() => select({ ...task, change_targets: ["../escape"] }, content), { code: "TASK_SCOPE_PATH_INVALID" });
});

test("mapping changes are consumed only by the existing profile launcher", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "profile-selection-mapping-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mappingPath = join(root, "profiles.json");
  const mapping = loadExecutionProfiles();
  const selection = decide();
  mapping.light = { ...mapping.standard, model: "fixture-future-model" };
  await writeFile(mappingPath, JSON.stringify(mapping));
  let spawns = 0;
  assert.equal(runCodexForProfile(selection.selected_profile, [], { mappingPath, spawn: (_cmd, args) => {
    spawns++;
    assert.equal(args[1], mapping.light.model);
    assert.equal(args[3], `model_reasoning_effort="${mapping.light.reasoning_effort}"`);
    return { status: 0 };
  } }), 0);
  assert.equal(spawns, 1);
  assert.deepEqual(decide(), selection);
  const source = await readFile("scripts/codex-profile-selection.mjs", "utf8");
  for (const { model } of Object.values(loadExecutionProfiles())) assert.equal(source.includes(model), false);
});
