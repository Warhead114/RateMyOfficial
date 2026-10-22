import type { EmailOutbox } from "@shared/schema";
import { EmailDeliveryPolicy } from "../policy";
import { freshWindow, rowHash, sendManifest, type SendManifest } from "./contracts";

// Only this explicit capability admits transactional validation types.
// Ordinary controlled/off/live policies and the original exact-test path are unchanged.
export class ScopedValidationPolicy extends EmailDeliveryPolicy {
  readonly manifest: SendManifest;
  constructor(manifest: SendManifest, private readonly clock = () => new Date()) {
    const parsed = sendManifest.parse(manifest);
    super({ mode: "controlled", controlledRecipients: parsed.recipients });
    this.manifest = parsed;
  }
  canClaimBroadQueue() { return false; }
  authorizeControlledRow(row: Pick<EmailOutbox, "type" | "recipientEmail">) {
    try {
      freshWindow(this.manifest.createdAt, this.manifest.expiresAt, this.clock());
      const expected = this.manifest.rows.find((r) => r.id === (row as EmailOutbox).id);
      return { allowed: !!expected && expected.type === row.type &&
        expected.recipientEmail === row.recipientEmail && expected.rowHash === rowHash(row as EmailOutbox),
      reason: "Exact manifest row binding" };
    } catch {
      return { allowed: false, reason: "Scoped authorization invalid" };
    }
  }
  authorizeProviderMessage(input: { recipientEmail: string; emailType?: string }) {
    try {
      freshWindow(this.manifest.createdAt, this.manifest.expiresAt, this.clock());
      return { allowed: this.manifest.rows.some((r) =>
        r.recipientEmail === input.recipientEmail && r.type === input.emailType),
      reason: "Scoped provider tuple; full message gate also required" };
    } catch { return { allowed: false, reason: "Scoped authorization expired" }; }
  }
}
