import type { EmailOutbox } from "@shared/schema";
import type { EmailMessage } from "./provider";
import type { SensitiveEmailPayloadProtector } from "./sensitive-payload";
import { renderEmailTemplate, type EmailTemplateType } from "./templates";

export async function renderOutboxMessage(row: EmailOutbox,
  protector: SensitiveEmailPayloadProtector, replyTo: string | null): Promise<EmailMessage> {
  let payload = row.payload;
  if (row.type === "password_reset") {
    if (!row.encryptedPayload) throw new Error("Encrypted password reset payload is missing");
    payload = { ...payload, ...await protector.open(row.type, row.encryptedPayload) };
  }
  const rendered = renderEmailTemplate(row.type as EmailTemplateType, payload as never);
  return { to: row.recipientEmail, subject: rendered.subject, html: rendered.html,
    text: rendered.text, idempotencyKey: row.deduplicationKey, replyTo,
    deadline: row.expiresAt,
    metadata: { type: rendered.metadata.type, privacy: rendered.metadata.privacy } };
}
