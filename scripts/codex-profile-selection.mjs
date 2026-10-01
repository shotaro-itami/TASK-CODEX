import { CodexProfileError } from "./codex-profile.mjs";
import { assertTaskScope, pathDecision, resolveScopePath } from "./spec/governance.mjs";

const PROFILES = ["light", "standard", "deep", "review"];
const INTENTS = ["maintenance", "implementation", "investigation", "independent-review", "implementation-and-review"];
const LIGHT_CHANGES = ["typo", "wording", "comment", "documentation"];
const NORMAL_CHANGES = ["feature", "bugfix", "test", "refactor"];
const RISKS = ["architecture", "security", "specification", "governance", "scope-guard", "destructive-operation", "complex-bug", "cross-feature", "cross-layer", "migration", "concurrency", "authentication", "authorization", "execution-infrastructure", "repository-wide"];
const REVIEWS = ["completion-review", "formal-review", "final-verification", "architecture-review", "security-review"];
const CHANGES = [...LIGHT_CHANGES, ...NORMAL_CHANGES, ...RISKS, ...REVIEWS];
const ordered = (values) => [...new Set(values)].sort();

export class ProfileSelectionError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "ProfileSelectionError";
  }
}

function undetermined(message) {
  throw new ProfileSelectionError("CODEX_TASK_PROFILE_UNDETERMINED", message);
}

function result(profile, source, reasons) {
  return Object.freeze({
    selected_profile: profile,
    selection_source: source,
    reason_codes: Object.freeze(ordered(reasons.map(([code]) => code))),
    selection_reason: ordered(reasons.map(([code, evidence]) => `${code}: ${evidence}`)).join("; "),
  });
}

// Only live, top-level sections participate. Fenced examples and blockquotes
// cannot provide intent or AC evidence. No natural-language inference is used.
function sections(content) {
  const body = content.replace(/\r\n?/gu, "\n").replace(/^---\n[\s\S]*?\n---(?:\n|$)/u, "");
  const found = new Map();
  let current;
  let fence;
  let comment = false;
  for (const line of body.split("\n")) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined;
      continue;
    }
    // Preserve whole-line exclusion, but consume every delimiter in order:
    // a later opener on the same line can extend the comment to later lines.
    let commentLine = comment;
    let offset = 0;
    while (offset < line.length) {
      const token = comment ? "-->" : "<!--";
      const index = line.indexOf(token, offset);
      if (index < 0) break;
      commentLine = true;
      comment = !comment;
      offset = index + token.length;
    }
    if (commentLine) continue;
    if (delimiter) {
      fence = delimiter[1];
      continue;
    }
    if (/^\s*>/u.test(line)) continue;
    const heading = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/u);
    if (heading && heading[1].length === 2) {
      current = (heading[2] ?? "").trim();
      if (found.has(current)) undetermined(`duplicate section: ${current}`);
      found.set(current, []);
    } else if (heading) current = undefined;
    else if (current) found.get(current).push(line);
  }
  if (fence || comment) undetermined("unclosed Markdown fence or comment");
  return found;
}

function readEvidence(task, content) {
  const found = sections(content);
  const goal = found.get("Goal") ?? [];
  const intents = goal.filter((line) => line.startsWith("Intent:")).map((line) => line.slice(7).trim());
  if (intents.length !== 1 || !INTENTS.includes(intents[0])) undetermined("Goal requires one Intent: marker with a supported task type");
  if (!goal.some((line) => line.trim() && !line.startsWith("Intent:"))) undetermined("Goal requires a description as well as Intent");
  const expected = task.acceptance_criteria;
  if (!Array.isArray(expected) || expected.length === 0 || new Set(expected).size !== expected.length || expected.some((id) => !/^AC-[0-9]+$/u.test(id))) undetermined("acceptance_criteria must list unique AC IDs");
  const entries = [];
  for (const line of found.get("Acceptance Criteria") ?? []) {
    if (!line.trim()) continue;
    const match = line.match(/^- \[[ xX]\] (AC-[0-9]+): \[change:([a-z-]+)\] \[risk:([a-z,-]+)\] (\S.*)$/u);
    if (!match) undetermined("each live Acceptance Criteria line must be an AC with change and risk markers");
    const [, id, change, riskText, description] = match;
    const risks = riskText.split(",");
    if (!CHANGES.includes(change) || risks.some((risk) => risk !== "none" && !RISKS.includes(risk)) ||
        new Set(risks).size !== risks.length || (risks.includes("none") && risks.length !== 1) ||
        /\[(?:risk|change):/u.test(description)) undetermined(`invalid or ambiguous AC markers: ${id}`);
    entries.push({ id, change, risks: risks.filter((risk) => risk !== "none") });
  }
  if (entries.length !== expected.length || new Set(entries.map(({ id }) => id)).size !== entries.length ||
      entries.some(({ id }) => !expected.includes(id))) undetermined("live AC IDs must match acceptance_criteria exactly");
  return { intent: intents[0], entries: entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}

function targetsFor(task, repoRoot) {
  assertTaskScope(task);
  if (!Array.isArray(task.change_targets) || task.change_targets.some((target) => typeof target !== "string" || target.includes("*"))) undetermined("change_targets must be an array of exact repository paths");
  const normalize = (value) => process.platform === "win32" ? value.replaceAll("\\", "/") : value;
  const administrative = new Set([`tasks/active/${task.id}.md`, `tasks/completed/${task.id}.md`, `tasks/anchors/${task.id}.json`]);
  const effective = ordered(task.allowed_paths.map(normalize).filter((target) => {
    // Identical forbidden globs remove the entire allowed expression. Other
    // glob subtraction is intentionally not guessed or enumerated from disk.
    if (task.forbidden_paths.map(normalize).includes(target)) return false;
    if (target.includes("*")) undetermined("unbounded allowed scope; use exact paths or an explicit profile");
    return pathDecision(target, task).allowed && !administrative.has(target);
  }));
  const targets = ordered(task.change_targets.map(normalize));
  if (targets.length !== task.change_targets.length) undetermined("duplicate change_targets");
  for (const target of targets) {
    if (administrative.has(target) || !pathDecision(target, task).allowed) undetermined(`change target must be allowed, non-administrative and not forbidden: ${target}`);
  }
  if (JSON.stringify(targets) !== JSON.stringify(effective)) undetermined("change_targets must cover the effective exact allowed scope, excluding this TASK's lifecycle paths");
  const resolved = repoRoot ? targets.map((target) => {
    const real = resolveScopePath(target, repoRoot);
    if (!pathDecision(real, task).allowed) undetermined(`resolved target is outside scope: ${target}`);
    return real;
  }) : targets;
  return { targets, resolved: ordered(resolved) };
}

function pathRisks(target) {
  const value = process.platform === "win32" ? target.toLowerCase() : target;
  const risks = [];
  if (/^(?:\.codex\/|\.agents\/|scripts\/codex-)/u.test(value)) risks.push("execution-infrastructure");
  if (target === "AGENTS.md" || /^(?:agents\.md$|scripts\/spec\/|scripts\/maintenance\/|tasks\/)/u.test(value)) risks.push("governance");
  if (/^docs\/(?:product-specs\/|spec-[^/]+|traceability\.yaml$|codex-task\.md$)/u.test(value)) risks.push("specification");
  if (/^(?:drizzle\/|scripts\/db\/)|(?:^|\/)migrations?(?:\/|\.)/u.test(value)) risks.push("migration");
  // Ordinary security documentation does not match executable security paths.
  if (/^(?:src|scripts|tools)\//u.test(value) && /(?:^|\/)(?:security|auth|authentication|authorization)(?:\/|\.)/u.test(value)) risks.push("security");
  return risks;
}

export function selectTaskExecutionProfile(task, content, { repoRoot } = {}) {
  if (Object.hasOwn(task, "execution_profile")) {
    if (typeof task.execution_profile !== "string" || !task.execution_profile.trim()) {
      throw new ProfileSelectionError("CODEX_TASK_PROFILE_REQUIRED", "explicit execution_profile must be a nonempty scalar");
    }
    if (!PROFILES.includes(task.execution_profile)) throw new CodexProfileError("CODEX_PROFILE_UNKNOWN", "unknown explicit execution_profile");
    return result(task.execution_profile, "explicit", [["explicit", "TASK frontmatter execution_profile"]]);
  }
  const { intent, entries } = readEvidence(task, content);
  const { targets, resolved } = targetsFor(task, repoRoot);
  const reviewEntries = entries.filter(({ change }) => REVIEWS.includes(change));
  const reasons = [[`intent:${intent}`, "Goal/Intent"], ["scope:exact-targets", `${targets.length} targets: ${targets.join(",") || "none"}`]];
  for (const { id, change, risks } of entries) {
    reasons.push([`change:${change}`, `Acceptance Criteria/${id}`]);
    for (const risk of ordered([...risks, ...(RISKS.includes(change) ? [change] : [])])) reasons.push([`risk:${risk}`, `Acceptance Criteria/${id}`]);
  }
  if (intent === "independent-review") {
    if (reviewEntries.length !== entries.length || targets.some((target) => !/^docs\/reviews\/[^*]+\.md$/u.test(target)) ||
        resolved.some((target) => !/^docs\/reviews\/[^*]+\.md$/u.test(target))) undetermined("independent review permits only review ACs and Markdown reports in docs/reviews");
    return result("review", "auto", reasons);
  }
  if (reviewEntries.length && intent !== "implementation-and-review") undetermined("review ACs conflict with Goal intent");
  if (intent === "implementation-and-review" && (!reviewEntries.length || reviewEntries.length === entries.length)) undetermined("mixed intent requires both implementation and review ACs");
  if (!targets.length) undetermined("implementation or investigation requires concrete change_targets");
  for (const target of ordered([...targets, ...resolved])) {
    for (const risk of pathRisks(target)) reasons.push([`risk:${risk}`, `target ${target}`]);
  }
  const riskTargets = resolved.map((target) => process.platform === "win32" ? target.toLowerCase() : target);
  const layers = ordered(riskTargets.map((target) => target.match(/^src\/(domain|application|infrastructure|presentation)\//u)?.[1]).filter(Boolean));
  if (layers.length > 1) reasons.push(["risk:cross-layer", layers.join(",")]);
  const components = ordered(riskTargets.map((target) => target.match(/^src\/(?:domain|application|infrastructure|presentation)\/([^/]+)\//u)?.[1]).filter(Boolean));
  if (components.length > 1) reasons.push(["risk:cross-feature", components.join(",")]);
  if (targets.length > 10) reasons.push(["risk:repository-wide", "more than 10 exact change targets"]);
  if (intent === "implementation-and-review") reasons.push(["risk:independent-review-required", "implement first; final review is a separate stage"]);
  if (reasons.some(([code]) => code.startsWith("risk:"))) return result("deep", "auto", reasons);
  if (intent === "investigation") undetermined("investigation needs an explicit risk marker or explicit profile");
  if (entries.some(({ change }) => !LIGHT_CHANGES.includes(change) && !NORMAL_CHANGES.includes(change))) undetermined("unsupported combination of intent and changes");
  const lightOnly = entries.every(({ change }) => LIGHT_CHANGES.includes(change));
  if (intent === "maintenance" && !lightOnly) undetermined("maintenance requires non-behavioral change kinds");
  return result(lightOnly && targets.length <= 3 ? "light" : "standard", "auto", [...reasons,
    [lightOnly && targets.length <= 3 ? "size:local" : "size:bounded", "non-risk exact scope; light limit 3, standard limit 10"],
  ]);
}
