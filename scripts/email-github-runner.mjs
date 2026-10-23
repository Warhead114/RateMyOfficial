// GitHub-only adapter. Never imported by application startup or deployment.
import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink, lstat, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { validateRunnerEnvironment } from "./email-production-runner.mjs";
import { PUBLIC_RUNNER_POLICY, validateGitHubContext, verifyGitHubProtection } from "./email-github-protection.mjs";
import { reportPublicKey, sealReport, writeSealedReport } from "./email-report-crypto.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = new Set(["evaluation_submitted", "password_reset", "event_created", "event_reminder"]);
const kinds = new Set(["fixtures", "capture", "send", "cleanup"]);
const demand = (condition) => {
  if (!condition) throw new Error("GitHub scoped validation refused");
};
const canonical = (v) => Array.isArray(v) ? v.map(canonical) :
  v && typeof v === "object" ? Object.fromEntries(
    Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const planDigest = v =>
  createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const parse = value => {
  demand(typeof value === "string" && Buffer.byteLength(value) <= 65536);
  return JSON.parse(value);
};
const isEmail = v => typeof v === "string" && v === v.trim().toLowerCase() &&
  v.length <= 320 && /^[^@\s*?]+@[^@\s*?]+\.[^@\s*?]+$/.test(v);

export function buildInvocation(env, policy = PUBLIC_RUNNER_POLICY) {
  validateRunnerEnvironment(env);
  validateGitHubContext(env, policy);
  const fixture = parse(env.EMAIL_VALIDATION_FIXTURE_JSON);
  demand(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(fixture.runId));
  const recipients = [fixture.coachEmail, fixture.alternateCoachEmail,
    fixture.supervisorEmail, fixture.adminEmail];
  demand(recipients.every(isEmail) && new Set(recipients).size === 4);
  demand(Number.isSafeInteger(fixture.adminUserId) && fixture.adminUserId > 0 &&
    Number.isSafeInteger(fixture.expectedProtectedOfficials) &&
    fixture.expectedProtectedOfficials >= 0 && fixture.expectedProtectedOfficials <= 10000);
  demand(/^\d{4}-\d{2}-\d{2}$/.test(fixture.evaluationDay) &&
    /^\d{4}-\d{2}-\d{2}$/.test(fixture.reminderDay) &&
    fixture.reminderDay > fixture.evaluationDay);
  const operation = env.EMAIL_GITHUB_OPERATION;
  demand(["preflight", "inspect", "plan-fixtures", "plan-capture",
    "plan-send", "plan-cleanup", "apply"].includes(operation));
  const acknowledgement = env.EMAIL_GITHUB_ACKNOWLEDGEMENT || "";
  if (operation !== "apply") demand(!acknowledgement);
  if (operation === "preflight" || operation === "inspect") {
    return { operation, runId: fixture.runId,
      args: operation === "inspect" ? ["inspect", fixture.runId] : ["preflight"] };
  }
  const input = operation === "plan-fixtures" ? fixture :
    operation === "plan-cleanup" ? { runId: fixture.runId } :
    parse(env.EMAIL_VALIDATION_INPUT_JSON);
  const kind = operation === "apply" ? input.kind : operation.slice(5);
  demand(kinds.has(kind));
  if (kind === "fixtures") demand(isDeepStrictEqual(
    operation === "apply" ? input.input : input, fixture));
  else demand((kind === "send" ? input.fixtureRunId : input.runId) === fixture.runId);
  if (kind === "send") {
    demand(Array.isArray(input.recipients) && input.recipients.length > 0 &&
      input.recipients.every(r => recipients.includes(r)));
    demand(Array.isArray(input.permittedTypes) && input.permittedTypes.length > 0 &&
      input.permittedTypes.every(t => types.has(t)));
    const rows = operation === "apply" ? input.rows : input.rowIds;
    demand(Array.isArray(rows) && rows.length >= 1 && rows.length <= 10);
    if (operation === "apply") demand(input.maxSends === rows.length &&
      rows.every(r => recipients.includes(r.recipientEmail) &&
        input.recipients.includes(r.recipientEmail) && types.has(r.type) &&
        input.permittedTypes.includes(r.type)));
  }
  if (operation === "apply") demand(
    acknowledgement === `${kind}:${planDigest(input)}`);
  return { operation, runId: fixture.runId, input,
    sendSlots: operation === "apply" && kind === "send" ? input.maxSends : 0,
    args: [operation, ".email-validation/github-input.json",
      ...(operation === "apply" ? [acknowledgement] : [])] };
}

// Reserve pessimistically: do not reclaim unused slots or ambiguous attempts.
// The existing CLI durably inserts max_attempts before any provider request.
export function checkBudget(reservations, nextSlots) {
  demand(Number.isInteger(nextSlots) && nextSlots >= 1 && nextSlots <= 10);
  demand(reservations.every(r => r.state === "complete" &&
    Number.isInteger(Number(r.max_attempts)) && Number(r.max_attempts) >= 1 &&
    Number(r.max_attempts) <= 10));
  demand(reservations.reduce((n, r) => n + Number(r.max_attempts), 0) + nextSlots <= 10);
}

// Ignore raw pool messages, but refuse ambiguous/multiple structured results.
export function parseCliResult(text) {
  const results = [];
  for (let start = 0; start < text.length; start++) {
    if ((start > 0 && text[start - 1] !== "\n") || !"{[".includes(text[start])) continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < text.length; end++) {
      const c = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if ("{[".includes(c)) depth++;
      else if ("}]".includes(c) && --depth === 0) {
        try {
          results.push(JSON.parse(text.slice(start, end + 1)));
          start = end;
        } catch {}
        break;
      }
    }
  }
  demand(results.length === 1);
  return results[0];
}

export function childEnvironment(env) {
  const names = ["PATH", "HOME", "LANG", "NODE_ENV", "DATABASE_URL",
    "SKIP_DATABASE_INITIALIZATION", "EMAIL_PRODUCTION_RUNNER_APPROVED",
    "EMAIL_DELIVERY_MODE", "EMAIL_VALIDATION_ENABLED", "EMAIL_WORKER_ENABLED",
    "EMAIL_RUNNER_APPROVED_REVISION", "EMAIL_RUNNER_EXPECTED_DB_HOST", "APP_URL",
    "EMAIL_SENSITIVE_PAYLOAD_KEY", "POSTMARK_SERVER_TOKEN", "EMAIL_FROM",
    "EMAIL_REPLY_TO", "POSTMARK_MESSAGE_STREAM"];
  return { ...Object.fromEntries(names.filter(n => env[n] !== undefined).map(n => [n, env[n]])),
    EMAIL_RUNNER_MACHINE_OUTPUT: "1" };
}

async function secureDirectory(directory, fresh = false) {
  await mkdir(directory, { mode: 0o700 }).catch(error => {
    if (fresh || error.code !== "EEXIST") throw new Error("Scoped validation refused");
  });
  const metadata = await lstat(directory);
  demand(metadata.isDirectory() && !metadata.isSymbolicLink() && (metadata.mode & 0o077) === 0);
}

export async function runScopedValidation(env, dependencies = {}) {
  const invocation = buildInvocation(env, dependencies.policy ?? PUBLIC_RUNNER_POLICY);
  demand(!env.EMAIL_REPORT_PRIVATE_KEY && !env.EMAIL_REPORT_DECRYPTION_KEY);
  const recipient = reportPublicKey(env.EMAIL_REPORT_PUBLIC_KEY, env.EMAIL_REPORT_KEY_SHA256);
  // Fail before GitHub/DB/provider access if local cryptography is unavailable.
  sealReport({ encryptionPreflight: true }, recipient);
  demand(isAbsolute(env.RUNNER_TEMP || ""));
  const temporaryRoot = await realpath(env.RUNNER_TEMP);
  const outside = relative(root, temporaryRoot);
  demand(outside.startsWith(".." + sep) && !root.startsWith(temporaryRoot + sep));
  await (dependencies.verifyProtection ?? verifyGitHubProtection)(env);
  const reportDirectory = resolve(temporaryRoot, "email-validation-sealed");
  await secureDirectory(reportDirectory, true);
  const inputPath = resolve(root, ".email-validation/github-input.json");
  let client;
  let inputCreated = false;
  let success = false;
  let result;
  try {
    if (invocation.input) {
      await secureDirectory(dirname(inputPath));
      await writeFile(inputPath, JSON.stringify(invocation.input), { mode: 0o600, flag: "wx" });
      inputCreated = true;
    }
    if (invocation.sendSlots) {
      const factory = dependencies.clientFactory ?? (config => new pg.Client(config));
      client = factory({ connectionString: env.DATABASE_URL,
        connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 10000 });
      await client.connect();
      // Only SELECTs here; no new schema, budget table or record mutation.
      const lock = await client.query(
        "SELECT pg_try_advisory_lock(hashtext('rmo-email-github-validation'), hashtext($1)) AS acquired",
        [invocation.runId]);
      demand(lock.rows[0]?.acquired === true);
      const reservations = await client.query(
        "SELECT state, max_attempts FROM public.email_validation_authorizations WHERE fixture_run_id = $1",
        [invocation.runId]);
      checkBudget(reservations.rows, invocation.sendSlots);
    }
    const child = (dependencies.spawn ?? spawnSync)(process.execPath,
      ["scripts/email-production-runner.mjs", ...invocation.args],
      { cwd: root, env: childEnvironment(env), encoding: "utf8", timeout: 160000, maxBuffer: 1048576 });
    demand(!child.error && child.status === 0);
    result = parseCliResult(child.stdout);
    success = true;
  } finally {
    await client?.end().catch(() => {});
    if (inputCreated) await unlink(inputPath);
    await writeSealedReport(reportDirectory, {
      operation: invocation.operation, runId: invocation.runId, success,
      sourceRevision: env.GITHUB_SHA, workflowRun: env.GITHUB_RUN_ID,
      ...(success ? { result } : { action: "Stop; inspect durable state and provider before retrying" }),
    }, recipient);
  }
  demand(success);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runScopedValidation(process.env).catch(() => {
    console.error("Scoped operation refused or interrupted. No automatic retry; inspect before proceeding.");
    process.exitCode = 1;
  });
}
