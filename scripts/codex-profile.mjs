import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_MAPPING_PATH = fileURLToPath(new URL("../.codex/execution-profiles.json", import.meta.url));
const REQUIRED_PROFILE_NAMES = Object.freeze(["light", "standard", "deep", "review"]);
const REQUIRED_PROFILE_FIELDS = Object.freeze(["model", "reasoning_effort"]);
const SUPPORTED_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._:/-]*$/iu;

export class CodexProfileError extends Error {
  constructor(code, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "CodexProfileError";
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code, message, options) {
  throw new CodexProfileError(code, message, options);
}

export function validateExecutionProfiles(value) {
  if (!isRecord(value)) {
    fail("CODEX_PROFILE_MAPPING_INVALID", "mapping root must be an object");
  }

  const actualNames = Object.keys(value);
  const missingNames = REQUIRED_PROFILE_NAMES.filter((name) => !actualNames.includes(name));
  const unexpectedNames = actualNames.filter((name) => !REQUIRED_PROFILE_NAMES.includes(name));
  if (missingNames.length > 0 || unexpectedNames.length > 0) {
    fail(
      "CODEX_PROFILE_MAPPING_INVALID",
      `profile set mismatch; missing=${missingNames.join(",") || "none"}; unexpected=${unexpectedNames.join(",") || "none"}`,
    );
  }

  for (const profileName of REQUIRED_PROFILE_NAMES) {
    const profile = value[profileName];
    if (!isRecord(profile)) {
      fail("CODEX_PROFILE_MAPPING_INVALID", `${profileName} must be an object`);
    }

    const actualFields = Object.keys(profile);
    const missingFields = REQUIRED_PROFILE_FIELDS.filter((field) => !actualFields.includes(field));
    const unexpectedFields = actualFields.filter((field) => !REQUIRED_PROFILE_FIELDS.includes(field));
    if (missingFields.length > 0 || unexpectedFields.length > 0) {
      fail(
        "CODEX_PROFILE_MAPPING_INVALID",
        `${profileName} fields mismatch; missing=${missingFields.join(",") || "none"}; unexpected=${unexpectedFields.join(",") || "none"}`,
      );
    }

    if (
      typeof profile.model !== "string" ||
      profile.model.length === 0 ||
      profile.model !== profile.model.trim() ||
      !MODEL_NAME_PATTERN.test(profile.model)
    ) {
      fail("CODEX_PROFILE_MODEL_INVALID", `${profileName}.model must be a non-empty model identifier`);
    }

    if (
      typeof profile.reasoning_effort !== "string" ||
      !SUPPORTED_REASONING_EFFORTS.has(profile.reasoning_effort)
    ) {
      fail(
        "CODEX_PROFILE_REASONING_INVALID",
        `${profileName}.reasoning_effort is not a supported value`,
      );
    }
  }

  return value;
}

export function loadExecutionProfiles(mappingPath = DEFAULT_MAPPING_PATH) {
  let source;
  try {
    source = readFileSync(mappingPath, "utf8");
  } catch (error) {
    fail("CODEX_PROFILE_MAPPING_READ_FAILED", `cannot read ${mappingPath}`, { cause: error });
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    fail("CODEX_PROFILE_MAPPING_PARSE_FAILED", `invalid JSON in ${mappingPath}`, { cause: error });
  }

  return validateExecutionProfiles(parsed);
}

export function selectExecutionProfile(mapping, profileName) {
  if (!REQUIRED_PROFILE_NAMES.includes(profileName)) {
    fail("CODEX_PROFILE_UNKNOWN", `unknown execution profile: ${profileName || "<missing>"}`);
  }
  return mapping[profileName];
}

function configKey(configOverride) {
  return configOverride.split("=", 1)[0].trim();
}

export function validatePassThroughArguments(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      break;
    }

    if (argument === "--model" || argument === "-m" || argument.startsWith("--model=") || /^-m.+/u.test(argument)) {
      fail("CODEX_PROFILE_OVERRIDE_FORBIDDEN", "pass-through arguments cannot override model");
    }

    let override;
    if (argument === "--config" || argument === "-c") {
      override = args[index + 1];
      index += 1;
    } else if (argument.startsWith("--config=")) {
      override = argument.slice("--config=".length);
    } else if (/^-c.+/u.test(argument)) {
      override = argument.replace(/^-c=?/u, "");
    }

    if (override !== undefined) {
      const key = configKey(override);
      if (key === "model" || key === "model_reasoning_effort") {
        fail(
          "CODEX_PROFILE_OVERRIDE_FORBIDDEN",
          `pass-through arguments cannot override ${key}`,
        );
      }
    }
  }

  return args;
}

export function buildCodexArguments(profile, passThroughArgs = []) {
  validatePassThroughArguments(passThroughArgs);
  return [
    "--model",
    profile.model,
    "--config",
    `model_reasoning_effort="${profile.reasoning_effort}"`,
    ...passThroughArgs,
  ];
}

export function runCodexForProfile(
  profileName,
  passThroughArgs = [],
  { mappingPath = DEFAULT_MAPPING_PATH, spawn = spawnSync } = {},
) {
  const mapping = loadExecutionProfiles(mappingPath);
  const profile = selectExecutionProfile(mapping, profileName);
  const args = buildCodexArguments(profile, passThroughArgs);
  const result = spawn("codex", args, {
    shell: false,
    stdio: "inherit",
    windowsHide: false,
  });

  if (result.error) {
    fail("CODEX_PROFILE_LAUNCH_FAILED", "failed to start Codex CLI", { cause: result.error });
  }
  if (!Number.isInteger(result.status)) {
    fail("CODEX_PROFILE_LAUNCH_FAILED", `Codex CLI ended without an exit status; signal=${result.signal || "unknown"}`);
  }
  return result.status;
}

function isMainModule() {
  return process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    process.exitCode = runCodexForProfile(process.argv[2], process.argv.slice(3));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
