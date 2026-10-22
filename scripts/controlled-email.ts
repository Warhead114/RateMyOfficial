import { randomUUID } from "node:crypto";
import { closePool, db } from "../server/db";
import { enqueueControlledDeliveryTest } from "../server/email/controlled-test";
import { EmailOutboxService } from "../server/email/outbox";
import { createEmailDeliveryPolicyFromEnv } from "../server/email/policy";
import { createPostmarkEmailProviderFromEnv } from "../server/email/provider";
import { EmailDeliveryWorker } from "../server/email/worker";

function usage(): never {
  throw new Error(
    "Usage: npm run email:controlled -- enqueue <recipient> <run-id> | run <outbox-id>",
  );
}

async function main(): Promise<void> {
  const [command, first, second, ...extra] = process.argv.slice(2);
  if (extra.length > 0) usage();

  const policy = createEmailDeliveryPolicyFromEnv();
  const outbox = new EmailOutboxService(db);

  if (command === "enqueue") {
    if (!first || !second) usage();
    const result = await enqueueControlledDeliveryTest({
      outbox,
      policy,
      recipientEmail: first,
      runId: second,
    });
    console.log(JSON.stringify({
      created: result.created,
      outboxId: result.row.id,
      status: result.row.status,
    }));
    return;
  }

  if (command === "run") {
    if (!first || second) usage();
    const outboxId = Number.parseInt(first, 10);
    if (!Number.isInteger(outboxId) || String(outboxId) !== first || outboxId < 1) {
      usage();
    }
    const provider = createPostmarkEmailProviderFromEnv();
    const worker = new EmailDeliveryWorker(outbox, provider, {
      workerId: `controlled-email-${randomUUID()}`,
      policy,
      replyTo: process.env.EMAIL_REPLY_TO?.trim() || null,
    });
    console.log(JSON.stringify(await worker.runExactOnce(outboxId)));
    return;
  }

  usage();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Controlled email command failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });