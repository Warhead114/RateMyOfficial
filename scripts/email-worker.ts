import { pool } from "../server/db";
import { EmailOutboxService } from "../server/email/outbox";
import { EmailDeliveryWorker } from "../server/email/worker";
import { createPostmarkEmailProviderFromEnv } from "../server/email/provider";
import { createEmailDeliveryPolicyFromEnv } from "../server/email/policy";
import { sensitiveEmailPayloadProtectorFromEnvironment } from "../server/email/sensitive-payload";
import { randomUUID } from "node:crypto";

// No scheduler or startup import. This future operator command is disabled by
// default and cannot drain a queue in controlled/off mode.
try {
  const policy = createEmailDeliveryPolicyFromEnv();
  if (process.argv.slice(2).join(" ") !== "--once" ||
      process.env.EMAIL_WORKER_ENABLED !== "1" || policy.mode !== "live") {
    throw new Error("Worker disabled: explicit --once, operator enablement and live mode are required");
  }
  const provider = createPostmarkEmailProviderFromEnv();
  if (provider.configurationFailure?.()) throw new Error("Email provider is not configured");
  const worker = new EmailDeliveryWorker(new EmailOutboxService(), provider, {
    workerId: `batch-${randomUUID()}`, policy,
    sensitivePayloadProtector: sensitiveEmailPayloadProtectorFromEnvironment(),
    replyTo: process.env.EMAIL_REPLY_TO,
  });
  console.log(JSON.stringify(await worker.runOnce()));
} catch {
  console.error("Email batch blocked or failed; check configuration and outbox status");
  process.exitCode = 1;
} finally {
  await pool.end();
}
