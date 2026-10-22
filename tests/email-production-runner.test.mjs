import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { validateRunnerEnvironment } from "../scripts/email-production-runner.mjs";

// Public synthetic values only. These tests never connect to a database or provider.
const fixture = () => ({
  NODE_ENV: "production", SKIP_DATABASE_INITIALIZATION: "1",
  EMAIL_PRODUCTION_RUNNER_APPROVED: "1", EMAIL_VALIDATION_ENABLED: "1",
  EMAIL_DELIVERY_MODE: "controlled",
  EMAIL_RUNNER_APPROVED_REVISION: "4117cec6b23d34639d7cbe3539fc6da7870bec41",
  EMAIL_RUNNER_EXPECTED_DB_HOST: "production.example.invalid",
  DATABASE_URL: "postgresql://test:synthetic@production.example.invalid/neondb?sslmode=require",
  APP_URL: "https://www.ratemyofficial.org",
  POSTMARK_SERVER_TOKEN: "synthetic-test-only", EMAIL_FROM: "test@example.invalid",
  EMAIL_REPLY_TO: "reply@example.invalid", POSTMARK_MESSAGE_STREAM: "outbound",
  EMAIL_SENSITIVE_PAYLOAD_KEY: "00".repeat(32),
});

test("pure runner validation accepts supported key encodings without changing its input", () => {
  const env = fixture(), original = { ...env };
  assert.equal(validateRunnerEnvironment(env), undefined);
  assert.deepEqual(env, original);
  env.EMAIL_SENSITIVE_PAYLOAD_KEY = Buffer.alloc(32).toString("base64");
  assert.equal(validateRunnerEnvironment(env), undefined);
});

for (const [name, override] of [
  ["Development workspace", { REPL_ID: "development" }],
  ["Development domain", { REPLIT_DEV_DOMAIN: "example.replit.dev" }],
  ["missing runner authorization", { EMAIL_PRODUCTION_RUNNER_APPROVED: "" }],
  ["non-Production process", { NODE_ENV: "development" }],
  ["startup initialization", { SKIP_DATABASE_INITIALIZATION: "" }],
  ["live delivery", { EMAIL_DELIVERY_MODE: "live" }],
  ["broad worker enablement", { EMAIL_WORKER_ENABLED: "1" }],
  ["missing validation enablement", { EMAIL_VALIDATION_ENABLED: "" }],
  ["missing approved revision", { EMAIL_RUNNER_APPROVED_REVISION: "" }],
  ["missing provider configuration", { POSTMARK_SERVER_TOKEN: "" }],
  ["noncanonical app URL", { APP_URL: "https://example.invalid" }],
  ["Development database", { DATABASE_URL: "postgresql://test:synthetic@production.example.invalid/heliumdb?sslmode=require" }],
  ["unexpected database host", { EMAIL_RUNNER_EXPECTED_DB_HOST: "other.example.invalid" }],
  ["unencrypted connection", { DATABASE_URL: "postgresql://test:synthetic@production.example.invalid/neondb" }],
  ["conflicting SSL modes", { DATABASE_URL: "postgresql://test:synthetic@production.example.invalid/neondb?sslmode=require&sslmode=disable" }],
  ["invalid key length", { EMAIL_SENSITIVE_PAYLOAD_KEY: "00" }],
  ["malformed Base64", { EMAIL_SENSITIVE_PAYLOAD_KEY: Buffer.alloc(32).toString("base64") + "!" }],
  ["malformed Base64 padding", { EMAIL_SENSITIVE_PAYLOAD_KEY: Buffer.alloc(32).toString("base64") + "=" }],
]) {
  test(`runner refuses ${name}`, () => {
    assert.throws(() => validateRunnerEnvironment({ ...fixture(), ...override }));
  });
}

test("required TLS in the URI survives the CLI pool's non-Neon SSL default", () => {
  const client = new pg.Client({ connectionString: fixture().DATABASE_URL, ssl: false });
  assert.ok(client.connectionParameters.ssl);
});

test("launcher refuses a Development invocation before connecting and emits no supplied values", () => {
  const marker = "DO-NOT-LOG-THIS";
  const result = spawnSync(process.execPath, ["scripts/email-production-runner.mjs", "preflight"], {
    encoding: "utf8", timeout: 10000,
    env: { PATH: process.env.PATH, REPL_ID: "development",
      DATABASE_URL: marker, EMAIL_SENSITIVE_PAYLOAD_KEY: marker },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production runner refused/);
  assert.ok(!(result.stdout + result.stderr).includes(marker));
});
