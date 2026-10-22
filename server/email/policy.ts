import type { EmailOutbox } from "@shared/schema";

export const emailDeliveryModes = ["off", "controlled", "live"] as const;
export type EmailDeliveryMode = typeof emailDeliveryModes[number];

export const CONTROLLED_DELIVERY_TEST_TYPE = "controlled_delivery_test";

export interface EmailDeliveryPolicyOptions {
  mode?: string | null;
  controlledRecipients?: string | string[] | null;
}

export interface ProviderMessageAuthorization {
  allowed: boolean;
  reason: string;
}

export function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    /[\r\n\t\s]/.test(normalized) ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
  ) {
    throw new Error("Invalid email address");
  }
  return normalized;
}

function parseControlledRecipients(
  value: string | string[] | null | undefined,
): { recipients: Set<string>; valid: boolean } {
  if (value === undefined || value === null) {
    return { recipients: new Set(), valid: false };
  }

  const entries = Array.isArray(value)
    ? value
    : value.split(/[,\n]/);
  if (entries.length === 0 || entries.some((entry) => entry.trim().length === 0)) {
    return { recipients: new Set(), valid: false };
  }

  const recipients = new Set<string>();
  try {
    for (const entry of entries) {
      recipients.add(normalizeEmailAddress(entry));
    }
  } catch {
    return { recipients: new Set(), valid: false };
  }

  return { recipients, valid: recipients.size > 0 };
}

export function parseEmailDeliveryMode(value: string | null | undefined): EmailDeliveryMode {
  const normalized = value?.trim().toLowerCase();
  return emailDeliveryModes.includes(normalized as EmailDeliveryMode)
    ? normalized as EmailDeliveryMode
    : "off";
}

export class EmailDeliveryPolicy {
  readonly mode: EmailDeliveryMode;
  readonly controlledRecipients: ReadonlySet<string>;
  readonly controlledRecipientsValid: boolean;

  constructor(options: EmailDeliveryPolicyOptions = {}) {
    this.mode = parseEmailDeliveryMode(options.mode);
    const parsed = parseControlledRecipients(options.controlledRecipients);
    this.controlledRecipients = parsed.recipients;
    this.controlledRecipientsValid = parsed.valid;
  }

  canClaimBroadQueue(): boolean {
    return this.mode === "live";
  }

  isControlledRecipient(email: string): boolean {
    try {
      return this.controlledRecipients.has(normalizeEmailAddress(email));
    } catch {
      return false;
    }
  }

  authorizeControlledRow(
    row: Pick<EmailOutbox, "type" | "recipientEmail">,
  ): ProviderMessageAuthorization {
    if (this.mode !== "controlled") {
      return {
        allowed: false,
        reason: this.mode === "off" ? "Delivery mode is off" : "Controlled mode is required",
      };
    }
    if (!this.controlledRecipientsValid) {
      return {
        allowed: false,
        reason: "Controlled recipient allowlist is missing or invalid",
      };
    }
    if (row.type !== CONTROLLED_DELIVERY_TEST_TYPE) {
      return {
        allowed: false,
        reason: "Only the controlled delivery test type is allowed",
      };
    }
    if (!this.isControlledRecipient(row.recipientEmail)) {
      return {
        allowed: false,
        reason: "Recipient is not allowlisted",
      };
    }
    return { allowed: true, reason: "Authorized controlled delivery row" };
  }

  authorizeProviderMessage(input: {
    recipientEmail: string;
    emailType?: string;
  }): ProviderMessageAuthorization {
    if (this.mode === "off") {
      return { allowed: false, reason: "Delivery mode is off" };
    }
    if (this.mode === "controlled") {
      return this.authorizeControlledRow({
        type: input.emailType ?? "",
        recipientEmail: input.recipientEmail,
      });
    }
    try {
      normalizeEmailAddress(input.recipientEmail);
      return { allowed: true, reason: "Live delivery mode is enabled" };
    } catch {
      return { allowed: false, reason: "Recipient is invalid" };
    }
  }
}

export function createEmailDeliveryPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmailDeliveryPolicy {
  return new EmailDeliveryPolicy({
    mode: env.EMAIL_DELIVERY_MODE,
    controlledRecipients: env.EMAIL_CONTROLLED_RECIPIENTS,
  });
}