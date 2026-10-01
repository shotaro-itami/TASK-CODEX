import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { SpecError } from "./errors.mjs";
import {
  EXPECTED_SPEC_VERSION,
  EXPECTED_SPREADSHEET_ID,
  GENERATED_SPEC_FILES,
  MANIFEST_PATH,
  REPO_ROOT,
  SNAPSHOT_PATH,
  SPEC_SYNC_OWNED_FILES,
} from "./config.mjs";
import { normalizeCell, normalizeRows, parseReferenceExpression, recordsForSheet, validateCanonicalSnapshot } from "./schema.mjs";

export {
  EXPECTED_SPEC_VERSION,
  EXPECTED_SPREADSHEET_ID,
  GENERATED_SPEC_FILES,
  MANIFEST_PATH,
  REPO_ROOT,
  SNAPSHOT_PATH,
  SPEC_SYNC_OWNED_FILES,
  normalizeCell,
  normalizeRows,
  recordsForSheet,
};

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeSheets(snapshot) {
  return snapshot.sheets.map((sheet) => ({
    name: normalizeCell(sheet.name),
    values: normalizeRows(sheet.values),
  }));
}

export function sourceFingerprint(snapshot) {
  validateCanonicalSnapshot(snapshot);
  return `sha256:${sha256(JSON.stringify(normalizeSheets(snapshot)))}`;
}

export async function readJson(relativePath, repoRoot = REPO_ROOT) {
  const targetPath = path.isAbsolute(relativePath) ? relativePath : path.join(repoRoot, relativePath);
  return JSON.parse(await readFile(targetPath, "utf8"));
}

export async function hashGeneratedFiles(relativePaths, repoRoot = REPO_ROOT) {
  const entries = [];
  for (const relativePath of [...relativePaths].sort()) {
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    entries.push([relativePath.replaceAll("\\", "/"), sha256(content.replace(/\r\n?/g, "\n"))]);
  }
  return `sha256:${sha256(JSON.stringify(entries))}`;
}

export function hashGeneratedContent(files) {
  const entries = [...files.entries()]
    .map(([relativePath, content]) => [relativePath.replaceAll("\\", "/"), sha256(String(content).replace(/\r\n?/g, "\n"))])
    .sort(([left], [right]) => left.localeCompare(right));
  return `sha256:${sha256(JSON.stringify(entries))}`;
}

export function parseIdList(value, expectedPrefix) {
  return parseReferenceExpression(value, expectedPrefix);
}

export function parseTaskFrontmatter(content, { strict = false } = {}) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const match = normalized.match(strict ? /^---\n([\s\S]*?)\n---(?:\n|$)/u : /^---\n([\s\S]*?)\n---/u);
  const invalid = () => { throw new SpecError("TASK_METADATA_INVALID", "TASK frontmatter", "unique flat keys and well-formed values with exact delimiter lines", "malformed frontmatter", "DET-075"); };
  if (!match) {
    if (strict) invalid();
    return null;
  }
  const result = strict ? Object.create(null) : {};
  for (const line of match[1].split("\n")) {
    if (strict && line.trim() === "") continue;
    const separator = line.indexOf(":");
    if (strict && !/^[a-z_]+:/u.test(line)) invalid();
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (strict && Object.hasOwn(result, key)) invalid();
    result[key] = raw.startsWith("[") && raw.endsWith("]")
      ? raw.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean)
      : raw;
  }
  return result;
}

export async function listMarkdownFiles(relativeDirectory, repoRoot = REPO_ROOT) {
  const directory = path.join(repoRoot, relativeDirectory);
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(relativeDirectory, entry.name).replaceAll("\\", "/"));
}
