import { readFile } from "node:fs/promises";
import { db, pool } from "../server/db";
import { sensitiveEmailPayloadProtectorFromEnvironment } from "../server/email/sensitive-payload";
import { digest, demand } from "../server/email/validation/contracts";
import { planFixtures, createFixtures, planCapture, captureFixtures } from "../server/email/validation/fixtures";
import { inspectFixtures, planCleanup, cleanupFixtures } from "../server/email/validation/cleanup";
import { planSend, executeSend, scopedPostmarkProvider, planRecovery, recoverClaim } from "../server/email/validation/dispatch";

async function json(path?: string) {
  demand(path, "A JSON input file is required");
  const text = await readFile(path, "utf8");
  demand(Buffer.byteLength(text) <= 65536, "Manifest too large");
  return JSON.parse(text);
}
async function main() {
  const [command, file, acknowledgement, ...extra] = process.argv.slice(2);
  demand(!extra.length, "Unexpected arguments");
  if (command === "inspect") {
    demand(file && !acknowledgement, "Usage: inspect <fixture-run-uuid>");
    console.log(JSON.stringify(await inspectFixtures(db, file), null, 2)); return;
  }
  demand(["plan-fixtures", "plan-capture", "plan-send", "plan-cleanup", "plan-recover", "apply"].includes(command),
    "Use plan-fixtures|plan-capture|plan-send|plan-cleanup|plan-recover <input.json>, inspect <run-id>, or apply <plan.json> <operation:sha256>");
  const input = await json(file);
  const context = () => ({
    protector: sensitiveEmailPayloadProtectorFromEnvironment(),
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || null,
  });
  if (command === "apply") {
    demand(acknowledgement, "Explicit operation/hash authorization required");
    let result;
    if (input.kind === "fixtures") result = await createFixtures(db, input, acknowledgement);
    else if (input.kind === "capture") result = await captureFixtures(db, input, acknowledgement);
    else if (input.kind === "cleanup") result = await cleanupFixtures(db, input, acknowledgement);
    else if (input.kind === "recover") result = await recoverClaim(db, input, acknowledgement);
    else if (input.kind === "send") result = await executeSend(db, input, acknowledgement, {
      ...context(), providerFactory: (policy) => scopedPostmarkProvider(policy),
    });
    else throw new Error("Unknown operation");
    console.log(JSON.stringify(result, null, 2)); return;
  }
  demand(!acknowledgement, "Dry runs do not accept execution authorization");
  const plan = command === "plan-fixtures" ? await planFixtures(db, input) :
    command === "plan-capture" ? await planCapture(db, input.runId, input.requested) :
    command === "plan-send" ? await planSend(db, input, context()) :
    command === "plan-cleanup" ? await planCleanup(db, input.runId) :
    await planRecovery(db, input.runId, input.rowId);
  // Copy only `plan` into a protected plan file. The approval string is not a
  // credential: privileged shell access + explicit enablement are also required.
  console.log(JSON.stringify({ plan, requiredAuthorization: `${plan.kind}:${digest(plan)}` }, null, 2));
}
main().catch(() => {
  // No raw Zod/Postgres errors: they can contain addresses or encrypted material.
  console.error("Email validation refused or interrupted. Review the scoped plan, configuration and journal.");
  process.exitCode = 1;
}).finally(() => pool.end());
