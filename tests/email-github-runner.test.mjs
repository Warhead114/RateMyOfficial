import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { buildInvocation, checkBudget, parseCliResult, planDigest } from "../scripts/email-github-runner.mjs";

// Synthetic fixtures only. No database, provider, GitHub API or actual CLI calls.
const scope = () => ({
  runId: "00000000-0000-4000-8000-000000000001",
  coachEmail: "operator+coach@example.invalid",
  alternateCoachEmail: "operator+alternate@example.invalid",
  supervisorEmail: "operator+supervisor@example.invalid",
  adminUserId: 7, adminEmail: "admin@example.invalid",
  evaluationDay: "2026-10-22", reminderDay: "2026-10-23", expectedProtectedOfficials: 18,
});
const fixture = () => ({
  NODE_ENV: "production", SKIP_DATABASE_INITIALIZATION: "1",
  EMAIL_PRODUCTION_RUNNER_APPROVED: "1", EMAIL_VALIDATION_ENABLED: "1",
  EMAIL_DELIVERY_MODE: "controlled", EMAIL_WORKER_ENABLED: "0",
  EMAIL_RUNNER_APPROVED_REVISION: "a".repeat(40),
  EMAIL_RUNNER_EXPECTED_DB_HOST: "production.example.invalid",
  DATABASE_URL: "postgresql://test:synthetic@production.example.invalid/neondb?sslmode=require",
  APP_URL: "https://www.ratemyofficial.org",
  POSTMARK_SERVER_TOKEN: "synthetic", EMAIL_FROM: "from@example.invalid",
  EMAIL_REPLY_TO: "reply@example.invalid", POSTMARK_MESSAGE_STREAM: "outbound",
  EMAIL_SENSITIVE_PAYLOAD_KEY: "00".repeat(32),
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SERVER_URL: "https://github.com", RUNNER_ENVIRONMENT: "github-hosted",
  EMAIL_GITHUB_PRIVATE_REPOSITORY: "true", EMAIL_VALIDATION_ENVIRONMENT_READY: "reviewers-required",
  GITHUB_REF: "refs/heads/main", EMAIL_VALIDATION_ALLOWED_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40), GITHUB_WORKFLOW_SHA: "a".repeat(40),
  EMAIL_VALIDATION_FIXTURE_JSON: JSON.stringify(scope()), EMAIL_GITHUB_OPERATION: "preflight",
});
const send = () => ({
  kind: "send", fixtureRunId: scope().runId, maxSends: 1,
  permittedTypes: ["event_created"], recipients: [scope().coachEmail],
  rows: [{ id: 17, type: "event_created", recipientEmail: scope().coachEmail }],
});
const apply = plan => ({
  ...fixture(), EMAIL_GITHUB_OPERATION: "apply",
  EMAIL_VALIDATION_INPUT_JSON: JSON.stringify(plan),
  EMAIL_GITHUB_ACKNOWLEDGEMENT: `${plan.kind}:${planDigest(plan)}`,
});

test("preflight, inspect and fixture planning use only protected fixed scope", () => {
  assert.deepEqual(buildInvocation(fixture()).args, ["preflight"]);
  assert.deepEqual(buildInvocation({ ...fixture(), EMAIL_GITHUB_OPERATION: "inspect" }).args,
    ["inspect", scope().runId]);
  const planned = buildInvocation({ ...fixture(), EMAIL_GITHUB_OPERATION: "plan-fixtures" });
  assert.deepEqual(planned.input, scope());
  assert.equal(planned.sendSlots, 0);
});
for (const [name, patch] of [
  ["non-GitHub runtime", { GITHUB_ACTIONS: "" }],
  ["automatic event", { GITHUB_EVENT_NAME: "schedule" }],
  ["unsupported GitHub server", { GITHUB_SERVER_URL: "https://github.example.invalid" }],
  ["persistent self-hosted runner", { RUNNER_ENVIRONMENT: "self-hosted" }],
  ["public repository", { EMAIL_GITHUB_PRIVATE_REPOSITORY: "false" }],
  ["rerun", { GITHUB_RUN_ATTEMPT: "2" }],
  ["unconfigured environment", { EMAIL_VALIDATION_ENVIRONMENT_READY: "" }],
  ["unapproved branch", { GITHUB_REF: "refs/heads/other" }],
  ["unapproved source", { GITHUB_SHA: "b".repeat(40) }],
  ["unapproved workflow", { GITHUB_WORKFLOW_SHA: "b".repeat(40) }],
  ["broad worker", { EMAIL_WORKER_ENABLED: "1" }],
  ["live mode", { EMAIL_DELIVERY_MODE: "live" }],
  ["Development database", { DATABASE_URL: "postgres://test:synthetic@production.example.invalid/heliumdb?sslmode=require" }],
  ["unencrypted database", { DATABASE_URL: "postgres://test:synthetic@production.example.invalid/neondb" }],
  ["arbitrary command", { EMAIL_GITHUB_OPERATION: "email:batch" }],
  ["shell injection", { EMAIL_GITHUB_OPERATION: "preflight; echo unsafe" }],
  ["recovery operation", { EMAIL_GITHUB_OPERATION: "plan-recover" }],
  ["misplaced acknowledgement", { EMAIL_GITHUB_ACKNOWLEDGEMENT: "send:" + "a".repeat(64) }],
]) test(`adapter refuses ${name}`, () => {
  assert.throws(() => buildInvocation({ ...fixture(), ...patch }));
});
test("adapter refuses duplicate recipients and changed fixture identities", () => {
  assert.throws(() => buildInvocation({ ...fixture(),
    EMAIL_VALIDATION_FIXTURE_JSON: JSON.stringify({ ...scope(), alternateCoachEmail: scope().coachEmail }) }));
  assert.throws(() => buildInvocation(apply({ kind: "fixtures",
    input: { ...scope(), coachEmail: "another@example.invalid" } })));
  assert.equal(buildInvocation(apply({ kind: "fixtures", input: scope() })).input.kind, "fixtures");
});
test("send planning binds run, addresses, permitted types and row count", () => {
  const input = { fixtureRunId: scope().runId, rowIds: [17],
    recipients: [scope().coachEmail], permittedTypes: ["event_created"], approvedBy: "synthetic" };
  const env = { ...fixture(), EMAIL_GITHUB_OPERATION: "plan-send" };
  assert.equal(buildInvocation({ ...env, EMAIL_VALIDATION_INPUT_JSON: JSON.stringify(input) }).sendSlots, 0);
  for (const patch of [
    { fixtureRunId: "00000000-0000-4000-8000-000000000002" },
    { recipients: ["another@example.invalid"] }, { permittedTypes: ["registration_received"] },
    { rowIds: [] }, { rowIds: Array(11).fill(17) },
  ]) assert.throws(() => buildInvocation({ ...env,
    EMAIL_VALIDATION_INPUT_JSON: JSON.stringify({ ...input, ...patch }) }));
});
test("apply requires exact digest and scoped send rows", () => {
  assert.equal(buildInvocation(apply(send())).sendSlots, 1);
  for (const patch of [
    { maxSends: 10 }, { recipients: ["another@example.invalid"] },
    { rows: [{ id: 17, type: "password_reset", recipientEmail: scope().coachEmail }] },
    { rows: [{ id: 17, type: "event_created", recipientEmail: "another@example.invalid" }] },
  ]) assert.throws(() => buildInvocation(apply({ ...send(), ...patch })));
  assert.throws(() => buildInvocation({ ...apply(send()), EMAIL_GITHUB_ACKNOWLEDGEMENT: "send:" + "f".repeat(64) }));
  assert.throws(() => buildInvocation(apply({ kind: "recover", fixtureRunId: scope().runId })));
});
test("capture and cleanup cannot target another run", () => {
  for (const operation of ["plan-capture", "apply"]) {
    const plan = { kind: "capture", runId: "00000000-0000-4000-8000-000000000002",
      requested: { reviewIds: [], tokenIds: [], outboxIds: [] } };
    assert.throws(() => buildInvocation(operation === "apply" ? apply(plan) : {
      ...fixture(), EMAIL_GITHUB_OPERATION: operation, EMAIL_VALIDATION_INPUT_JSON: JSON.stringify(plan),
    }));
  }
  assert.deepEqual(buildInvocation({ ...fixture(), EMAIL_GITHUB_OPERATION: "plan-cleanup" }).input,
    { runId: scope().runId });
});
test("durable reservations cannot exceed ten or reclaim ambiguous slots", () => {
  assert.doesNotThrow(() => checkBudget([], 10));
  assert.doesNotThrow(() => checkBudget([{ state: "complete", max_attempts: 7 }], 3));
  assert.throws(() => checkBudget([{ state: "complete", max_attempts: 7 }], 4));
  for (const state of ["running", "interrupted", "unknown"]) {
    assert.throws(() => checkBudget([{ state, max_attempts: 1 }], 1));
  }
  assert.throws(() => checkBudget([], 11));
  assert.throws(() => checkBudget([{ state: "complete", max_attempts: -1 }], 1));
});
test("structured reports exclude preceding and trailing raw process messages", () => {
  const expected = { plan: { quoted: 'a "}[" brace', rows: [1, 2] }, requiredAuthorization: "synthetic" };
  assert.deepEqual(parseCliResult("New database client connected\n" + JSON.stringify(expected, null, 2) +
    "\nClient removed from pool\n"), expected);
  assert.deepEqual(parseCliResult("connected\n[]\nremoved"), []);
  assert.throws(() => parseCliResult("raw error must not enter artifacts"));
});
test("Development invocation refuses without network access or exposing supplied values", () => {
  const marker = "NEVER-LOG-SYNTHETIC-SECRETS";
  const child = spawnSync(process.execPath, ["scripts/email-github-runner.mjs"], {
    env: { PATH: process.env.PATH, REPL_ID: "development", DATABASE_URL: marker },
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(child.status, 1);
  assert.ok(!(child.stdout + child.stderr).includes(marker));
  assert.match(child.stderr, /refused or interrupted/);
});
test("workflow has only dispatch, pinned actions, private environment and narrow permissions", () => {
  const workflow = readFileSync(".github/workflows/production-email-validation.yml", "utf8");
  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|pull_request_target|schedule|workflow_call):/m);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /write-all|contents: write|id-token: write|secrets: inherit/);
  assert.match(workflow, /environment: production-email-validation/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /package-manager-cache: false/);
  const references = [...workflow.matchAll(/uses: ([^\s]+)/g)].map(m => m[1]);
  assert.equal(references.length, 3);
  assert.ok(references.every(r => /@[a-f0-9]{40}$/.test(r)));
  assert.match(workflow, /secrets\.RMO_PRODUCTION_DATABASE_URL/);
  assert.doesNotMatch(workflow, /email:batch|email:controlled|npm run dev|npm start|db:push/);
});
