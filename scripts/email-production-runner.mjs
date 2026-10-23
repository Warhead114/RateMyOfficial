// Operator-only launcher. Never imported by the web app, build, or scheduler.
import { access, stat } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

// Audited public source baseline, independent of private Replit commit ancestry.
const reviewedSourceDigest = "7caf71d4b426f900e22e2a8213a83adc7be2f654444db4a1233135355c65bbc0";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demand = (condition) => {
  if (!condition) throw new Error("Production runner refused");
};

// Pure checks: no connections, secret output, or environment modifications.
export function validateRunnerEnvironment(env) {
  demand(!env.REPL_ID && !env.REPLIT_DEV_DOMAIN);
  demand(env.EMAIL_PRODUCTION_RUNNER_APPROVED === "1");
  demand(env.NODE_ENV === "production" && env.SKIP_DATABASE_INITIALIZATION === "1");
  demand(env.EMAIL_DELIVERY_MODE === "controlled");
  demand(env.EMAIL_VALIDATION_ENABLED === "1" && env.EMAIL_WORKER_ENABLED !== "1");
  demand(/^[0-9a-f]{40}$/i.test(env.EMAIL_RUNNER_APPROVED_REVISION || ""));
  for (const name of ["POSTMARK_SERVER_TOKEN", "EMAIL_FROM", "EMAIL_REPLY_TO",
    "POSTMARK_MESSAGE_STREAM", "EMAIL_SENSITIVE_PAYLOAD_KEY", "EMAIL_RUNNER_EXPECTED_DB_HOST"]) {
    demand(typeof env[name] === "string" && env[name].trim().length > 0);
  }
  const app = new URL(env.APP_URL);
  demand(app.origin === "https://www.ratemyofficial.org" && app.pathname === "/" &&
    !app.username && !app.password && !app.search && !app.hash);
  const database = new URL(env.DATABASE_URL);
  demand(["postgres:", "postgresql:"].includes(database.protocol));
  demand(database.hostname === env.EMAIL_RUNNER_EXPECTED_DB_HOST &&
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(database.hostname));
  demand(database.pathname === "/neondb");
  demand(database.searchParams.getAll("sslmode").length === 1 &&
    ["require", "verify-full"].includes(database.searchParams.get("sslmode")));
  const encoded = env.EMAIL_SENSITIVE_PAYLOAD_KEY;
  const hex = /^[0-9a-f]{64}$/i.test(encoded);
  const key = Buffer.from(encoded, hex ? "hex" : "base64");
  const valid = key.length === 32 && (hex || encoded === key.toString("base64") ||
    encoded === key.toString("base64").replace(/=+$/, ""));
  key.fill(0);
  demand(valid);
}

async function main() {
  validateRunnerEnvironment(process.env);
  const args = process.argv.slice(2);
  const preflight = args[0] === "preflight";
  demand(preflight ? args.length === 1 :
    ["inspect", "plan-fixtures", "plan-capture", "plan-send", "plan-cleanup",
      "plan-recover", "apply"].includes(args[0]) &&
      args.length === (args[0] === "apply" ? 3 : 2));
  const git = (...args) => execFileSync("git", args,
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  demand(git("rev-parse", "HEAD") === process.env.EMAIL_RUNNER_APPROVED_REVISION);
  demand(git("status", "--porcelain", "--untracked-files=normal") === "");
  const reviewedFiles = git("ls-tree", "-r", "--full-tree", "HEAD", "--",
    "server", "shared", "scripts/email-validation.ts", "package.json", "package-lock.json");
  demand(createHash("sha256").update(reviewedFiles).digest("hex") === reviewedSourceDigest);
  const bundle = resolve(root, "dist/email-validation.js");
  await access(bundle);
  if (!preflight && args[0] !== "inspect") {
    const input = resolve(root, args[1]);
    demand(input.startsWith(resolve(root, ".email-validation") + sep));
    demand(((await stat(input)).mode & 0o077) === 0);
  }

  // A single SELECT verifies the actual external target and negotiated TLS.
  // No startup DDL, application imports, provider requests, or schema changes.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 10000 });
  try {
    await client.connect();
    const result = await client.query(`SELECT current_database() AS database_name,
      (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS encrypted`);
    demand(result.rows[0]?.database_name === "neondb" && result.rows[0]?.encrypted === true);
  } finally {
    await client.end();
  }
  if (preflight || process.env.EMAIL_RUNNER_MACHINE_OUTPUT !== "1") {
    console.log(JSON.stringify({ runnerPreflightPassed: true, productionDatabaseVerified: true,
      tlsVerified: true, keyFormatValid: true }));
  }
  if (preflight) return;

  // Exactly one invocation. A timeout may leave ambiguous provider acceptance:
  // stop and inspect the original journal/provider before any separately approved retry.
  const child = spawn(process.execPath, [bundle, ...args], { cwd: root, stdio: "inherit",
    timeout: 120000, killSignal: "SIGKILL" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      process.exitCode = code === 0 ? 0 : 1;
      if (code !== 0) console.error("One-shot failed or interrupted; stop and inspect before retry.");
      resolve();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Production runner refused; inspect configuration privately. No automatic retry.");
    process.exitCode = 1;
  });
}
