import type { EnqueueEmailResult } from "./outbox";
import {
  CONTROLLED_DELIVERY_TEST_TYPE,
  normalizeEmailAddress,
  type EmailDeliveryPolicy,
} from "./policy";

export interface ControlledTestOutbox {
  enqueue(input: {
    type: typeof CONTROLLED_DELIVERY_TEST_TYPE;
    recipientEmail: string;
    payload: Record<string, never>;
    deduplicationKey: string;
    scheduledFor: Date;
    expiresAt: Date;
    maxAttempts: number;
  }): Promise<EnqueueEmailResult>;
}

export interface EnqueueControlledDeliveryTestInput {
  outbox: ControlledTestOutbox;
  policy: EmailDeliveryPolicy;
  recipientEmail: string;
  runId: string;
  now?: Date;
}

export async function enqueueControlledDeliveryTest(
  input: EnqueueControlledDeliveryTestInput,
): Promise<EnqueueEmailResult> {
  const recipientEmail = normalizeEmailAddress(input.recipientEmail);
  const authorization = input.policy.authorizeControlledRow({
    type: CONTROLLED_DELIVERY_TEST_TYPE,
    recipientEmail,
  });
  if (!authorization.allowed) {
    throw new Error("Controlled delivery test is not authorized");
  }

  const runId = input.runId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,199}$/.test(runId)) {
    throw new Error("Controlled delivery test run ID is invalid");
  }

  const now = input.now ?? new Date();
  return input.outbox.enqueue({
    type: CONTROLLED_DELIVERY_TEST_TYPE,
    recipientEmail,
    payload: {},
    deduplicationKey: `controlled-delivery-test:${runId}`,
    scheduledFor: now,
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    maxAttempts: 2,
  });
}