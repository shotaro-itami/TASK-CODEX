import { createSign } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { EXPECTED_SPREADSHEET_ID, REPO_ROOT } from "./config.mjs";
import { SpecError, assertSpec } from "./errors.mjs";

const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const GOOGLE_HTTP_LIMITS = Object.freeze({
  requestTimeoutMs: 30_000,
  oauthResponseMaxBytes: 64 * 1024,
  sheetsResponseMaxBytes: 8 * 1024 * 1024,
});

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}
function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveCredentialFilePath(credentialPath, repoRoot) {
  const resolvedCredential = path.resolve(credentialPath);
  const resolvedRepo = path.resolve(repoRoot);
  assertSpec(
    !isInside(resolvedRepo, resolvedCredential),
    "SPEC_CREDENTIAL_PATH_FORBIDDEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "path outside repository root",
    "path resolves inside repository root",
  );

  let realCredential;
  let realRepo;
  try {
    [realCredential, realRepo] = await Promise.all([realpath(resolvedCredential), realpath(resolvedRepo)]);
  } catch {
    throw new SpecError(
      "SPEC_AUTH_INVALID",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "resolvable credential and repository paths",
      "path cannot be resolved",
    );
  }
  assertSpec(
    !isInside(realRepo, realCredential),
    "SPEC_CREDENTIAL_PATH_FORBIDDEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "real path outside repository root",
    "real path resolves inside repository root",
  );
  return realCredential;
}

function declaredContentLength(response) {
  const value = response?.headers?.get?.("content-length");
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readBoundedResponse(response, maxBytes, target) {
  const declaredBytes = declaredContentLength(response);
  if (declaredBytes != null && declaredBytes > maxBytes) {
    throw new SpecError("SPEC_REMOTE_RESPONSE_TOO_LARGE", target, `at most ${maxBytes} bytes`, `Content-Length ${declaredBytes} bytes`);
  }

  const reader = response?.body?.getReader?.();
  assertSpec(Boolean(reader), "SPEC_REMOTE_RESPONSE_INVALID", target, "readable response body", "body stream unavailable");
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new SpecError("SPEC_REMOTE_RESPONSE_TOO_LARGE", target, `at most ${maxBytes} bytes`, `more than ${maxBytes} bytes received`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function fetchBoundedJson({ fetchImpl, url, options = {}, target, timeoutMs, maxBytes }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const body = await readBoundedResponse(response, maxBytes, target);
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      // Callers map malformed JSON according to the endpoint and never expose body content.
    }
    return { response, payload };
  } catch (error) {
    if (error instanceof SpecError) throw error;
    if (controller.signal.aborted) {
      throw new SpecError("SPEC_REMOTE_TIMEOUT", target, `response within ${timeoutMs} ms`, "request timed out");
    }
    throw new SpecError("SPEC_REMOTE_FETCH_FAILED", target, "reachable endpoint", "network or response stream failure");
  } finally {
    clearTimeout(timeout);
  }
}

function effectiveValue(cell) {
  if (cell?.formattedValue != null) return String(cell.formattedValue);
  const value = cell?.effectiveValue ?? cell?.userEnteredValue ?? {};
  if (value.stringValue != null) return String(value.stringValue);
  if (value.numberValue != null) return String(value.numberValue);
  if (value.boolValue != null) return String(value.boolValue);
  if (value.errorValue != null) return String(value.errorValue.message ?? value.errorValue.type ?? "");
  return "";
}

function toRawRows(sheet) {
  const rows = [];
  for (const grid of sheet.data ?? []) {
    const startRow = grid.startRow ?? 0;
    const startColumn = grid.startColumn ?? 0;
    for (let rowOffset = 0; rowOffset < (grid.rowData ?? []).length; rowOffset += 1) {
      const rowIndex = startRow + rowOffset;
      rows[rowIndex] ??= [];
      const values = grid.rowData[rowOffset]?.values ?? [];
      for (let columnOffset = 0; columnOffset < values.length; columnOffset += 1) {
        const cell = values[columnOffset] ?? {};
        rows[rowIndex][startColumn + columnOffset] = {
          value: effectiveValue(cell),
          formula: String(cell.userEnteredValue?.formulaValue ?? ""),
        };
      }
    }
  }
  return rows.map((row) => row ?? []);
}

export function googleResponseToRawSource(payload) {
  assertSpec(payload && typeof payload === "object", "SPEC_REMOTE_RESPONSE_INVALID", "Google Sheets response", "object", typeof payload);
  return {
    format_version: 1,
    source_spreadsheet_id: payload.spreadsheetId,
    source_title: String(payload.properties?.title ?? ""),
    sheets: [...(payload.sheets ?? [])]
      .sort((left, right) => (left.properties?.index ?? 0) - (right.properties?.index ?? 0))
      .map((sheet) => ({
        name: String(sheet.properties?.title ?? ""),
        sheet_id: sheet.properties?.sheetId,
        row_count: sheet.properties?.gridProperties?.rowCount,
        column_count: sheet.properties?.gridProperties?.columnCount,
        rows: toRawRows(sheet),
      })),
  };
}

async function serviceAccountAccessToken(credentials, fetchImpl, nowSeconds, limits) {
  assertSpec(credentials?.type === "service_account", "SPEC_AUTH_INVALID", "credential type", "service_account", credentials?.type ?? "missing");
  assertSpec(Boolean(credentials.client_email && credentials.private_key && credentials.token_uri), "SPEC_AUTH_INVALID", "service account credential", "client_email/private_key/token_uri", "missing required field");
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: READ_ONLY_SCOPE,
    aud: credentials.token_uri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  let signature;
  try {
    signature = signer.sign(credentials.private_key).toString("base64url");
  } catch {
    throw new SpecError("SPEC_AUTH_INVALID", "service account private key", "valid RSA private key", "invalid key");
  }
  const { response, payload } = await fetchBoundedJson({
    fetchImpl,
    url: credentials.token_uri,
    target: "Google OAuth token endpoint",
    timeoutMs: limits.requestTimeoutMs,
    maxBytes: limits.oauthResponseMaxBytes,
    options: {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    },
  });
  if (!response.ok) throw new SpecError("SPEC_AUTH_FAILED", "Google OAuth token exchange", "HTTP 200", `HTTP ${response.status}`);
  assertSpec(Boolean(payload?.access_token), "SPEC_AUTH_FAILED", "Google OAuth token exchange", "access token", "missing token");
  return payload.access_token;
}

export async function resolveAccessToken({
  env = process.env,
  fetchImpl = globalThis.fetch,
  repoRoot = REPO_ROOT,
  now = () => Date.now(),
  limits = GOOGLE_HTTP_LIMITS,
} = {}) {
  if (env.GOOGLE_SHEETS_ACCESS_TOKEN) return env.GOOGLE_SHEETS_ACCESS_TOKEN;
  const credentialPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  assertSpec(Boolean(credentialPath), "SPEC_AUTH_MISSING", "Google Sheets authentication", "GOOGLE_SHEETS_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS", "not configured");
  const resolved = await resolveCredentialFilePath(credentialPath, repoRoot);
  let credentials;
  try {
    credentials = JSON.parse(await readFile(resolved, "utf8"));
  } catch {
    throw new SpecError("SPEC_AUTH_INVALID", "GOOGLE_APPLICATION_CREDENTIALS", "readable service account JSON outside repository", "unreadable or malformed");
  }
  return serviceAccountAccessToken(credentials, fetchImpl, Math.floor(now() / 1000), limits);
}

export async function fetchGoogleSheetRaw({
  spreadsheetId = EXPECTED_SPREADSHEET_ID,
  env = process.env,
  fetchImpl = globalThis.fetch,
  repoRoot = REPO_ROOT,
  now,
  limits = GOOGLE_HTTP_LIMITS,
} = {}) {
  const accessToken = await resolveAccessToken({ env, fetchImpl, repoRoot, now, limits });
  const fields = "spreadsheetId,properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,userEnteredValue))))";
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set("includeGridData", "true");
  url.searchParams.set("fields", fields);
  const { response, payload } = await fetchBoundedJson({
    fetchImpl,
    url,
    target: "Google Sheets API",
    timeoutMs: limits.requestTimeoutMs,
    maxBytes: limits.sheetsResponseMaxBytes,
    options: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "SPEC_AUTH_FAILED" : "SPEC_REMOTE_FETCH_FAILED";
    throw new SpecError(code, "Google Sheets API", "HTTP 200", `HTTP ${response.status}`);
  }
  assertSpec(payload != null, "SPEC_REMOTE_RESPONSE_INVALID", "Google Sheets API", "valid JSON response", "malformed or truncated JSON");
  return googleResponseToRawSource(payload);
}
