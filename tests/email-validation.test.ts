import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { digest, freshWindow, operatorGate, sendManifest, exactEmail, rowHash } from "../server/email/validation/contracts";
import { ScopedValidationPolicy } from "../server/email/validation/scoped-policy";
import { EmailDeliveryPolicy } from "../server/email/policy";
import type { EmailOutbox } from "../shared/schema";

const now = new Date();
const row = { id: 2, type: "event_created", recipientUserId: 3,
  recipientEmail: "approved@example.test", payload: {}, encryptedPayload: null,
  deduplicationKey: "fixture:2", scheduledFor: now, expiresAt: null,
  maxAttempts: 5 } as EmailOutbox;
const manifest = () => ({
  kind: "send" as const, authorizationId: randomUUID(), fixtureRunId: randomUUID(),
  approvedBy: "Test operator", createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60_000).toISOString(), maxSends: 1,
  recipients: [row.recipientEmail], permittedTypes: ["event_created" as const],
  rows: [{ id: row.id, type: "event_created" as const, recipientEmail: row.recipientEmail,
    rowHash: rowHash(row), messageHash: digest("message") }],
});
const enabled = { EMAIL_VALIDATION_ENABLED: "1", EMAIL_DELIVERY_MODE: "controlled",
  EMAIL_WORKER_ENABLED: "0", SKIP_DATABASE_INITIALIZATION: "1" };
test("manifest requires exact unique IDs/types/addresses and a hard count", () => {
  assert.ok(sendManifest.safeParse(manifest()).success);
  for (const altered of [
    { ...manifest(), rows: [manifest().rows[0], manifest().rows[0]], maxSends: 2 },
    { ...manifest(), recipients: ["*@example.test"] },
    { ...manifest(), permittedTypes: ["password_reset"] },
    { ...manifest(), maxSends: 2 }, { ...manifest(), surprise: true },
    { ...manifest(), recipients: [] }, { ...manifest(), maxSends: 11 },
  ]) assert.equal(sendManifest.safeParse(altered).success, false);
  assert.throws(() => exactEmail("approved@example.test\nBcc:x@example.test"));
  assert.throws(() => exactEmail("*@example.test"));
});
test("explicit operation/hash, enablement and controlled-only gates fail closed", () => {
  const plan = manifest(), ack = `send:${digest(plan)}`;
  operatorGate("send", plan, ack, enabled);
  for (const env of [{}, { ...enabled, EMAIL_VALIDATION_ENABLED: "0" },
    { ...enabled, EMAIL_DELIVERY_MODE: "live" }, { ...enabled, EMAIL_WORKER_ENABLED: "1" },
    { ...enabled, SKIP_DATABASE_INITIALIZATION: "0" }]) {
    assert.throws(() => operatorGate("send", plan, ack, env));
  }
  assert.throws(() => operatorGate("send", plan, "cleanup:" + digest(plan), enabled));
  assert.throws(() => operatorGate("send", { ...plan, approvedBy: "changed" }, ack, enabled));
});
test("capability is row/content bound and never authorizes a broad queue", () => {
  const scope = new ScopedValidationPolicy(sendManifest.parse(manifest()), () => now);
  assert.equal(scope.canClaimBroadQueue(), false);
  assert.equal(scope.authorizeControlledRow(row).allowed, true);
  for (const altered of [{ ...row, id: 4 }, { ...row, payload: { injected: true } },
    { ...row, recipientEmail: "attacker@example.test" }, { ...row, type: "password_reset" }]) {
    assert.equal(scope.authorizeControlledRow(altered as EmailOutbox).allowed, false);
  }
  assert.equal(scope.authorizeProviderMessage({ recipientEmail: "attacker@example.test",
    emailType: row.type }).allowed, false);
  const oldPolicy = new EmailDeliveryPolicy({ mode: "controlled", controlledRecipients: [row.recipientEmail] });
  assert.equal(oldPolicy.authorizeControlledRow(row).allowed, false);
});
test("expired, future-dated and overlong authorizations are rejected", () => {
  assert.throws(() => freshWindow(now.toISOString(), now.toISOString(), now));
  assert.throws(() => freshWindow(new Date(now.getTime() + 1).toISOString(),
    new Date(now.getTime() + 60_000).toISOString(), now));
  assert.throws(() => freshWindow(now.toISOString(),
    new Date(now.getTime() + 16 * 60_000).toISOString(), now));
});
