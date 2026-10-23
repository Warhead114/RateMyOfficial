import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createHash, generateKeyPairSync, privateDecrypt, createDecipheriv, constants } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, rmdir, mkdir, writeFile, chmod, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { reportPublicKey, sealReport, writeSealedReport, validateSealedReport } from "../scripts/email-report-crypto.mjs";
import { checkArtifact } from "../scripts/email-report-artifact.mjs";
import { PUBLIC_RUNNER_POLICY, validateGitHubContext, verifyGitHubProtection } from "../scripts/email-github-protection.mjs";
import { childEnvironment, runScopedValidation, planDigest } from "../scripts/email-github-runner.mjs";
import { decryptReport } from "../scripts/email-report-decrypt.mjs";

// Ephemeral synthetic keys only: no real keys, external requests, DB or provider.
const pair = generateKeyPairSync("rsa", { modulusLength: 3072 });
const pem = pair.publicKey.export({ type: "spki", format: "pem" });
const fingerprint = createHash("sha256").update(
  pair.publicKey.export({ type: "spki", format: "der" })).digest("hex");
const recipient = reportPublicKey(pem, fingerprint);
const aad = Buffer.from("RateMyOfficial/email-validation-report/v1");
function decrypt(envelope, privateKey = pair.privateKey) {
  const key = privateDecrypt({ key: privateKey, oaepHash: "sha256",
    oaepLabel: aad, padding: constants.RSA_PKCS1_OAEP_PADDING },
  Buffer.from(envelope.wrappedKey, "base64"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString());
  } finally { key.fill(0); }
}
const temps = [];
async function temporary() {
  const dir = await mkdtemp(resolve(tmpdir(), "rmo-public-runner-"));
  temps.push(dir); return dir;
}
after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
  await rmdir(resolve(".email-validation")).catch(() => {});
});
const scope = () => ({
  runId: "00000000-0000-4000-8000-000000000001", coachEmail: "coach@example.invalid",
  alternateCoachEmail: "alternate@example.invalid", supervisorEmail: "supervisor@example.invalid",
  adminEmail: "admin@example.invalid", adminUserId: 7, expectedProtectedOfficials: 18,
  evaluationDay: "2026-10-22", reminderDay: "2026-10-23",
});
const fixture = () => ({
  NODE_ENV: "production", SKIP_DATABASE_INITIALIZATION: "1", EMAIL_PRODUCTION_RUNNER_APPROVED: "1",
  EMAIL_DELIVERY_MODE: "controlled", EMAIL_VALIDATION_ENABLED: "1", EMAIL_WORKER_ENABLED: "0",
  EMAIL_RUNNER_APPROVED_REVISION: "a".repeat(40), EMAIL_RUNNER_EXPECTED_DB_HOST: "production.example.invalid",
  DATABASE_URL: "postgresql://synthetic:synthetic@production.example.invalid/neondb?sslmode=require",
  APP_URL: "https://www.ratemyofficial.org", POSTMARK_SERVER_TOKEN: "SYNTHETIC-PROVIDER-SECRET",
  EMAIL_FROM: "sender@example.invalid", EMAIL_REPLY_TO: "reply@example.invalid",
  POSTMARK_MESSAGE_STREAM: "outbound", EMAIL_SENSITIVE_PAYLOAD_KEY: "00".repeat(32),
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SERVER_URL: "https://github.com", RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY: PUBLIC_RUNNER_POLICY.repository, GITHUB_REPOSITORY_ID: PUBLIC_RUNNER_POLICY.repositoryId,
  GITHUB_REPOSITORY_OWNER_ID: PUBLIC_RUNNER_POLICY.ownerId, GITHUB_RUN_ID: "123",
  GITHUB_ACTOR_ID: "1", GITHUB_TRIGGERING_ACTOR: "synthetic-operator",
  GITHUB_API_URL: "https://api.github.com", GITHUB_TOKEN: "SYNTHETIC-READ-ONLY-TOKEN",
  EMAIL_GITHUB_PRIVATE_REPOSITORY: "true", EMAIL_VALIDATION_ENVIRONMENT_READY: "reviewers-required",
  GITHUB_REF: "refs/heads/main", EMAIL_VALIDATION_ALLOWED_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40), GITHUB_WORKFLOW_SHA: "a".repeat(40),
  EMAIL_VALIDATION_FIXTURE_JSON: JSON.stringify(scope()), EMAIL_GITHUB_OPERATION: "preflight",
  EMAIL_REPORT_PUBLIC_KEY: pem, EMAIL_REPORT_KEY_SHA256: fingerprint,
});

test("hybrid encryption round-trips only with offline private key and randomized ciphertext", () => {
  const value = { recipient: scope().coachEmail, secret: "SYNTHETIC-ONLY", rows: [1, 2] };
  const a = sealReport(value, recipient), b = sealReport(value, recipient);
  assert.deepEqual(decrypt(a), value);
  assert.deepEqual(decryptReport(a, pair.privateKey.export({ type: "pkcs8", format: "pem" })), value);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notEqual(a.wrappedKey, b.wrappedKey);
  assert.ok(!JSON.stringify(a).includes(value.recipient));
  assert.ok(!JSON.stringify(a).includes(value.secret));
  assert.equal(validateSealedReport(a, fingerprint), true);
  const changed = { ...a, ciphertext: Buffer.from("tampered").toString("base64") };
  assert.throws(() => decrypt(changed));
  assert.throws(() => decrypt({ ...a, tag: Buffer.alloc(16).toString("base64") }));
  assert.throws(() => decrypt({ ...a, iv: Buffer.alloc(12).toString("base64") }));
});

test("crypto refuses private, weak, unsupported, malformed and unpinned keys without echoing input", () => {
  const weak = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  for (const [key, fp] of [
    [pair.privateKey.export({ type: "pkcs8", format: "pem" }), fingerprint],
    [weak.publicKey.export({ type: "spki", format: "pem" }), fingerprint],
    [ec.publicKey.export({ type: "spki", format: "pem" }), fingerprint],
    ["DO-NOT-ECHO-SYNTHETIC-KEY", fingerprint], [pem, "f".repeat(64)], [pem, ""],
  ]) assert.throws(() => reportPublicKey(key, fp), error => error.message === "Sealed report refused");
  assert.throws(() => sealReport({ tooLarge: "x".repeat(2 * 1024 * 1024) }, recipient));
});

test("artifact gate refuses extra plaintext fields, bad encodings, permissive files and symlinks", async () => {
  const dir = await temporary(), file = resolve(dir, "report.enc.json");
  await writeSealedReport(dir, { private: "synthetic" }, recipient);
  await checkArtifact(dir, fingerprint);
  assert.deepEqual(await readdir(dir), ["report.enc.json"]);
  const good = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(decrypt(good), { private: "synthetic" });
  await assert.rejects(writeSealedReport(dir, { mustNotReplace: true }, recipient));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), good);
  assert.deepEqual(await readdir(dir), ["report.enc.json"]);
  for (const patch of [{ recipientEmail: scope().coachEmail }, { iv: "bad" }, { tag: "" },
    { wrappedKey: "bad" }, { ciphertext: "bad" }, { keyFingerprint: "f".repeat(64) }]) {
    assert.throws(() => validateSealedReport({ ...good, ...patch }, fingerprint));
  }
  await chmod(file, 0o644); await assert.rejects(checkArtifact(dir, fingerprint));
  await rm(file); await symlink(resolve(dir, "missing"), file);
  await assert.rejects(checkArtifact(dir, fingerprint));
});

test("public admission is implemented but immutable production policy still disables it", () => {
  const publicEnv = { ...fixture(), EMAIL_GITHUB_PRIVATE_REPOSITORY: "false" };
  assert.equal(PUBLIC_RUNNER_POLICY.enabled, false);
  assert.ok(Object.isFrozen(PUBLIC_RUNNER_POLICY));
  assert.throws(() => validateGitHubContext(publicEnv));
  // A hypothetical later reviewed policy is tested without changing shipped policy.
  const later = { ...PUBLIC_RUNNER_POLICY, enabled: true };
  assert.doesNotThrow(() => validateGitHubContext(publicEnv, later));
  for (const patch of [
    { GITHUB_REPOSITORY: "other/repository" }, { GITHUB_REPOSITORY_ID: "99" },
    { GITHUB_REPOSITORY_OWNER_ID: "99" }, { GITHUB_RUN_ID: "../bad" },
    { EMAIL_GITHUB_PRIVATE_REPOSITORY: "" }, { RUNNER_DEBUG: "1" },
    { ACTIONS_STEP_DEBUG: "true" }, { ACTIONS_RUNNER_DEBUG: "true" },
    { NODE_OPTIONS: "--inspect" }, { NODE_V8_COVERAGE: "/tmp/coverage" },
  ]) assert.throws(() => validateGitHubContext({ ...publicEnv, ...patch }, later));
});

const apiFixture = () => ({
  repository: { id: 947276986, owner: { id: 133118238 }, full_name: PUBLIC_RUNNER_POLICY.repository,
    private: true, default_branch: "main" },
  run: { id: 123, status: "in_progress", head_sha: "a".repeat(40), head_branch: "main",
    event: "workflow_dispatch", run_attempt: 1,
    repository: { id: 947276986 }, path: ".github/workflows/production-email-validation.yml@main",
    actor: { id: 1 }, triggering_actor: { id: 1, login: "synthetic-operator" } },
  environment: { id: 456, name: "production-email-validation", can_admins_bypass: false,
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
    protection_rules: [{ type: "required_reviewers", prevent_self_review: true,
      reviewers: [{ type: "User", reviewer: { id: 2 } }] }] },
  branches: { total_count: 1, branch_policies: [{ type: "branch", name: "main" }] },
  approvals: [{ state: "approved", user: { id: 2 }, environments: [{ id: 456 }] }],
});
const mockApi = (data, observe = () => {}) => async (url, options) => {
  observe(url, options);
  const key = url.endsWith("/approvals") ? "approvals" :
    url.endsWith("/deployment-branch-policies") ? "branches" :
    url.includes("/environments/") ? "environment" :
    url.includes("/actions/runs/") ? "run" : "repository";
  return { ok: true, text: async () => JSON.stringify(data[key]) };
};
test("approval verification reads only fixed GitHub endpoints with least-privilege token", async () => {
  let requests = 0;
  assert.equal(await verifyGitHubProtection(fixture(), mockApi(apiFixture(), (url, options) => {
    requests++;
    assert.ok(url.startsWith("https://api.github.com/repos/Warhead114/RateMyOfficial"));
    assert.equal(options.redirect, "error"); assert.equal(options.method, undefined);
    assert.equal(options.headers.Authorization, "Bearer SYNTHETIC-READ-ONLY-TOKEN");
    assert.ok(!JSON.stringify(options).includes("SYNTHETIC-PROVIDER-SECRET"));
  })), true);
  assert.equal(requests, 5);
});
for (const [label, mutate] of [
  ["admin bypass", d => { d.environment.can_admins_bypass = true; }],
  ["self review enabled", d => { d.environment.protection_rules[0].prevent_self_review = false; }],
  ["missing reviewers", d => { d.environment.protection_rules = []; }],
  ["branch wildcard", d => { d.branches.branch_policies[0].name = "*"; }],
  ["extra allowed branch", d => { d.branches.total_count = 2; }],
  ["tag admission", d => { d.branches.branch_policies[0].type = "tag"; }],
  ["wrong repository", d => { d.repository.id = 99; }],
  ["changed visibility", d => { d.repository.private = false; }],
  ["wrong source", d => { d.run.head_sha = "b".repeat(40); }],
  ["wrong workflow run", d => { d.run.id = 999; }],
  ["historical approval replay", d => { d.run.status = "completed"; }],
  ["different triggering actor", d => { d.run.triggering_actor.login = "other-operator"; }],
  ["automatic invocation", d => { d.run.event = "schedule"; }],
  ["rerun", d => { d.run.run_attempt = 2; }],
  ["wrong workflow", d => { d.run.path = ".github/workflows/other.yml"; }],
  ["missing approval", d => { d.approvals = []; }],
  ["self approval", d => {
    d.environment.protection_rules[0].reviewers[0].reviewer.id = 1;
    d.approvals[0].user.id = 1;
  }],
  ["triggering actor approval", d => { d.run.triggering_actor.id = 2; }],
  ["unlisted approver", d => { d.approvals[0].user.id = 3; }],
  ["malformed reviewer identity", d => {
    d.environment.protection_rules[0].reviewers = [{ type: "User", reviewer: {} }];
    d.approvals[0].user = {};
  }],
  ["wrong environment approval", d => { d.approvals[0].environments[0].id = 99; }],
  ["rejected environment", d => { d.approvals.push({ ...d.approvals[0], state: "rejected" }); }],
]) test(`live protection check refuses ${label}`, async () => {
  const data = apiFixture(); mutate(data);
  await assert.rejects(verifyGitHubProtection(fixture(), mockApi(data)), /GitHub protection refused/);
});
test("API failures and debug/error details never escape verification", async () => {
  for (const impl of [
    async () => { throw new Error("DO-NOT-LOG-RAW-API-ERROR"); },
    async () => ({ ok: false }),
    async () => ({ ok: true, text: async () => "invalid DO-NOT-LOG-RAW-API-ERROR" }),
  ]) await assert.rejects(verifyGitHubProtection(fixture(), impl),
    error => error.message === "GitHub protection refused");
});

test("child environment strips GitHub token, private manifests, report keys and tracing hooks", () => {
  const env = fixture(), child = childEnvironment({ ...env, NODE_OPTIONS: "--inspect",
    EXTRA_SECRET: "never-copy", EMAIL_REPORT_PRIVATE_KEY: "never-copy" });
  for (const key of ["GITHUB_TOKEN", "EMAIL_VALIDATION_FIXTURE_JSON", "EMAIL_VALIDATION_INPUT_JSON",
    "EMAIL_GITHUB_ACKNOWLEDGEMENT", "EMAIL_REPORT_PUBLIC_KEY", "EMAIL_REPORT_PRIVATE_KEY",
    "EXTRA_SECRET", "NODE_OPTIONS"]) assert.equal(child[key], undefined);
  assert.equal(child.DATABASE_URL, env.DATABASE_URL);
  assert.equal(child.EMAIL_RUNNER_MACHINE_OUTPUT, "1");
});
test("synthetic execution seals successful and failed reports without raw subprocess output", async () => {
  for (const failed of [false, true]) {
    const dir = await temporary(), env = { ...fixture(), RUNNER_TEMP: dir };
    const run = runScopedValidation(env, { verifyProtection: async () => true,
      spawn: (_node, args, options) => {
        assert.equal(options.env.GITHUB_TOKEN, undefined);
        assert.equal(args[1], "preflight");
        return { status: failed ? 1 : 0,
          stdout: failed ? "SYNTHETIC-RAW-SECRET" : '{"runnerPreflightPassed":true}',
          stderr: "SYNTHETIC-RAW-SECRET" };
      } });
    if (failed) await assert.rejects(run); else await run;
    const artifact = resolve(dir, "email-validation-sealed/report.enc.json");
    const text = await readFile(artifact, "utf8"), value = decrypt(JSON.parse(text));
    assert.equal(value.success, !failed);
    assert.equal(value.runId, scope().runId);
    assert.equal(value.sourceRevision, env.GITHUB_SHA);
    assert.ok(!JSON.stringify(value).includes("SYNTHETIC-RAW-SECRET"));
    assert.ok(!text.includes(scope().runId));
    assert.ok(!text.includes("SYNTHETIC"));
    await checkArtifact(resolve(dir, "email-validation-sealed"), fingerprint);
  }
});
test("missing encryption or approvals prevents all CLI/database access and report creation", async () => {
  for (const patch of [
    { EMAIL_REPORT_KEY_SHA256: "" }, { EMAIL_REPORT_PUBLIC_KEY: "" },
    { EMAIL_GITHUB_PRIVATE_REPOSITORY: "false" }, { EMAIL_REPORT_PRIVATE_KEY: "not-allowed" },
  ]) {
    const dir = await temporary();
    await assert.rejects(runScopedValidation({ ...fixture(), RUNNER_TEMP: dir, ...patch }, {
      verifyProtection: () => assert.fail("No API access"),
      spawn: () => assert.fail("No CLI access"), clientFactory: () => assert.fail("No DB access"),
    }));
    assert.deepEqual(await readdir(dir), []);
  }
  const dir = await temporary();
  await assert.rejects(runScopedValidation({ ...fixture(), RUNNER_TEMP: dir }, {
    verifyProtection: async () => { throw new Error("No approval"); },
    spawn: () => assert.fail("No CLI access"), clientFactory: () => assert.fail("No DB access"),
  }));
  assert.deepEqual(await readdir(dir), []);
});
test("launcher suppresses its extra preflight document only in machine-output mode", () => {
  const source = readFileSync("scripts/email-production-runner.mjs", "utf8");
  assert.match(source, /preflight \|\| process\.env\.EMAIL_RUNNER_MACHINE_OUTPUT !== "1"/);
  assert.match(source, /git\("status", "--porcelain"/);
  assert.match(source, /reviewedSourceDigest/);
});

test("hypothetical activated public path verifies protection and seals a plan end-to-end", async () => {
  const dir = await temporary(), data = apiFixture(); data.repository.private = false;
  const env = { ...fixture(), RUNNER_TEMP: dir, EMAIL_GITHUB_PRIVATE_REPOSITORY: "false",
    EMAIL_GITHUB_OPERATION: "plan-fixtures" };
  const result = { plan: { kind: "fixtures", input: scope() }, requiredAuthorization: "synthetic" };
  await runScopedValidation(env, {
    policy: { ...PUBLIC_RUNNER_POLICY, enabled: true },
    verifyProtection: e => verifyGitHubProtection(e, mockApi(data)),
    spawn: (_node, args, options) => {
      assert.equal(args[1], "plan-fixtures");
      const input = resolve(args[2]);
      assert.deepEqual(JSON.parse(readFileSync(input, "utf8")), scope());
      assert.equal(options.env.EMAIL_VALIDATION_FIXTURE_JSON, undefined);
      return { status: 0, stdout: JSON.stringify(result), stderr: "DROP-SYNTHETIC-RAW-DIAGNOSTIC" };
    },
  });
  const sealed = JSON.parse(await readFile(resolve(dir, "email-validation-sealed/report.enc.json"), "utf8"));
  assert.deepEqual(decrypt(sealed).result, result);
  await assert.rejects(lstat(resolve(".email-validation/github-input.json")));
});

test("send wrapper holds the durable lock and never exceeds ten cumulative reservations", async () => {
  const plan = { kind: "send", fixtureRunId: scope().runId, maxSends: 1,
    permittedTypes: ["event_created"], recipients: [scope().coachEmail],
    rows: [{ id: 17, type: "event_created", recipientEmail: scope().coachEmail }] };
  for (const [reservations, allowed] of [
    [[{ state: "complete", max_attempts: 9 }], true],
    [[{ state: "complete", max_attempts: 10 }], false],
    [[{ state: "interrupted", max_attempts: 1 }], false],
  ]) {
    const dir = await temporary(), events = [];
    const env = { ...fixture(), RUNNER_TEMP: dir, EMAIL_GITHUB_OPERATION: "apply",
      EMAIL_VALIDATION_INPUT_JSON: JSON.stringify(plan), EMAIL_GITHUB_ACKNOWLEDGEMENT: `send:${planDigest(plan)}` };
    const promise = runScopedValidation(env, {
      verifyProtection: async () => true,
      clientFactory: () => ({
        connect: async () => { events.push("connect"); },
        query: async sql => {
          if (sql.includes("pg_try_advisory_lock")) { events.push("lock"); return { rows: [{ acquired: true }] }; }
          assert.ok(sql.includes("email_validation_authorizations"));
          events.push("budget"); return { rows: reservations };
        },
        end: async () => { events.push("close"); },
      }),
      spawn: () => { events.push("CLI"); return { status: 0, stdout: '{"attempted":1}' }; },
    });
    if (allowed) await promise; else await assert.rejects(promise);
    assert.deepEqual(events, ["connect", "lock", "budget", ...(allowed ? ["CLI"] : []), "close"]);
    await assert.rejects(lstat(resolve(".email-validation/github-input.json")));
  }
});

test("input collisions do not remove existing operator input or invoke the CLI", async () => {
  const dir = await temporary(), input = resolve(".email-validation/github-input.json");
  await mkdir(dirnameForInput(), { mode: 0o700, recursive: true });
  await writeFile(input, "SYNTHETIC-EXISTING-INPUT", { mode: 0o600, flag: "wx" });
  try {
    await assert.rejects(runScopedValidation({ ...fixture(), RUNNER_TEMP: dir,
      EMAIL_GITHUB_OPERATION: "plan-fixtures" }, {
      verifyProtection: async () => true, spawn: () => assert.fail("Must not execute"),
    }));
    assert.equal(await readFile(input, "utf8"), "SYNTHETIC-EXISTING-INPUT");
  } finally { await rm(input); }
});
function dirnameForInput() { return resolve(".email-validation"); }

test("offline decryption CLI never writes plaintext to stdout and refuses GitHub execution", async () => {
  const dir = await temporary(), input = resolve(dir, "report.enc.json");
  const key = resolve(dir, "operator.key"), output = resolve(dir, "report.json");
  await writeFile(key, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await writeFile(input, JSON.stringify(sealReport({ recipient: scope().coachEmail }, recipient)));
  const args = ["scripts/email-report-decrypt.mjs", input, key, output];
  const child = spawnSync(process.execPath, args, { env: {}, encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0); assert.equal(child.stdout + child.stderr, "");
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { recipient: scope().coachEmail });
  assert.equal((await lstat(output)).mode & 0o077, 0);
  const refused = spawnSync(process.execPath, args, { env: { GITHUB_ACTIONS: "true" }, encoding: "utf8" });
  assert.equal(refused.status, 1); assert.equal(refused.stdout, "");
  assert.equal(refused.stderr.trim(), "Offline decryption refused.");
  const other = generateKeyPairSync("rsa", { modulusLength: 3072 });
  assert.throws(() => decryptReport(JSON.parse(readFileSync(input)), other.privateKey.export({
    type: "pkcs8", format: "pem" })), /Offline decryption refused/);
});

test("actual workflow shell wrapper confines all subprocess output to private temporary storage", async () => {
  const dir = await temporary(), bin = resolve(dir, "bin");
  await mkdir(bin, { mode: 0o700 });
  await writeFile(resolve(bin, "node"),
    '#!/bin/sh\nprintf "SYNTHETIC-PRIVATE-STDOUT\\n"\nprintf "recipient@example.invalid\\n" >&2\nexit 1\n',
    { mode: 0o700 });
  const workflow = readFileSync(".github/workflows/production-email-validation.yml", "utf8");
  const body = workflow.match(/        run: \|\n(          umask 077[\s\S]*?)      - name: Verify sealed/)[1]
    .split("\n").map(line => line.replace(/^          /, "")).join("\n");
  const child = spawnSync("bash", ["--noprofile", "--norc", "-euo", "pipefail", "-c", body], {
    env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: dir }, encoding: "utf8",
  });
  assert.equal(child.status, 1);
  assert.ok(!(child.stdout + child.stderr).includes("SYNTHETIC-PRIVATE-STDOUT"));
  assert.ok(!(child.stdout + child.stderr).includes("recipient@example.invalid"));
  const log = resolve(dir, "email-validation-private/process.log");
  assert.match(await readFile(log, "utf8"), /SYNTHETIC-PRIVATE-STDOUT/);
  assert.equal((await lstat(log)).mode & 0o077, 0);
  assert.match(workflow, /if: always\(\) && steps\.sealed\.outcome == 'success'/);
  assert.match(workflow, /rm -rf -- "\$RUNNER_TEMP\/email-validation-private"/);
});

test("artifact CLI exposes only a static refusal for plaintext or malformed files", async () => {
  const dir = await temporary(), sealed = resolve(dir, "email-validation-sealed");
  await mkdir(sealed, { mode: 0o700 });
  await writeFile(resolve(sealed, "report.enc.json"),
    JSON.stringify({ recipient: "SYNTHETIC-PRIVATE-MARKER@example.invalid" }), { mode: 0o600 });
  const child = spawnSync(process.execPath, ["scripts/email-report-artifact.mjs"], {
    env: { RUNNER_TEMP: dir, EMAIL_REPORT_KEY_SHA256: fingerprint }, encoding: "utf8",
  });
  assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.equal(child.stderr.trim(), "No verified sealed report is available.");
});
