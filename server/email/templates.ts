import { z } from "zod";
import {
  emailOutboxTypes,
  type EmailOutbox,
} from "@shared/schema";

export type EmailTemplateType = typeof emailOutboxTypes[number];

const name = z.string().trim().min(1).max(120);
const safeUrl = z.string().trim().min(1).max(2048).refine(
  (value) => /^(?:https?:\/\/|\/)[^\r\n]*$/i.test(value),
  "URL must be an HTTP(S) or application-relative URL",
);
const eventName = z.string().trim().min(1).max(240);
const eventStart = z.string().trim().min(1).max(160);
const venue = z.string().trim().min(1).max(240);
const eventContext = {
  eventId: z.number().int().positive().optional(),
  version: z.number().int().nonnegative().optional(),
  identityKey: z.string().uuid().optional(),
  reminderKind: z.enum(["day_of", "day_after"]).optional(),
};

const templateSchemas = {
  registration_received: z.object({
    firstName: name,
    loginUrl: safeUrl.optional(),
  }).strict(),
  account_approved: z.object({
    firstName: name,
    loginUrl: safeUrl.optional(),
  }).strict(),
  account_rejected: z.object({
    firstName: name,
    supportUrl: safeUrl.optional(),
  }).strict(),
  evaluation_submitted: z.object({
    firstName: name,
    eventName,
    officialName: name,
    isPending: z.boolean(),
    reviewUrl: safeUrl.optional(),
    audience: z.literal("reviewer").optional(),
    coachName: name.optional(),
  }).strict(),
  password_reset: z.object({
    resetUrl: safeUrl,
    expiresInMinutes: z.number().int().positive().max(1440),
  }).strict(),
  controlled_delivery_test: z.object({}).strict(),
  event_created: z.object({
    ...eventContext,
    firstName: name,
    eventName,
    eventStart,
    venue,
    assignedOfficials: z.array(name).max(50),
    eventUrl: safeUrl.optional(),
  }).strict(),
  event_reminder: z.object({
    ...eventContext,
    firstName: name,
    eventName,
    eventStart,
    venue,
    assignedOfficials: z.array(name).max(50),
    eventUrl: safeUrl.optional(),
  }).strict(),
} satisfies Record<EmailTemplateType, z.ZodTypeAny>;

export type EmailTemplatePayload = {
  [Type in EmailTemplateType]: z.infer<typeof templateSchemas[Type]>;
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  metadata: {
    type: EmailTemplateType;
    privacy: "transactional";
  };
}

export function parseTemplatePayload<T extends EmailTemplateType>(
  type: T,
  payload: unknown,
): EmailTemplatePayload[T] {
  return templateSchemas[type].parse(payload) as EmailTemplatePayload[T];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textValue(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function linkHtml(label: string, url?: string): string {
  return url
    ? `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`
    : "";
}

function layout(title: string, content: string): string {
  return `<!doctype html><html><body><main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`;
}

function officialsText(officials: string[]): string {
  return officials.length > 0
    ? officials.map(textValue).join(", ")
    : "Assigned officials will be listed in the app.";
}

function officialsHtml(officials: string[]): string {
  return officials.length > 0
    ? `<ul>${officials.map((official) => `<li>${escapeHtml(official)}</li>`).join("")}</ul>`
    : "<p>Assigned officials will be listed in the app.</p>";
}

export function renderEmailTemplate<T extends EmailTemplateType>(
  type: T,
  payload: EmailTemplatePayload[T],
): RenderedEmail {
  const data = parseTemplatePayload(type, payload);

  switch (type) {
    case "registration_received": {
      const value = data as EmailTemplatePayload["registration_received"];
      return {
        subject: "RateMyOfficial registration received",
        html: layout(
          "Registration received",
          `<p>Hello ${escapeHtml(value.firstName)},</p><p>We received your RateMyOfficial registration. Your account is pending administrator approval.</p><p>We will notify you when an administrator approves or rejects your application.</p>${linkHtml("Open RateMyOfficial", value.loginUrl)}`,
        ),
        text: `Hello ${textValue(value.firstName)},\n\nWe received your RateMyOfficial registration. Your account is pending administrator approval. We will notify you when an administrator approves or rejects your application.${value.loginUrl ? `\n\nOpen RateMyOfficial: ${textValue(value.loginUrl)}` : ""}`,
        metadata: { type, privacy: "transactional" },
      };
    }
    case "account_approved": {
      const value = data as EmailTemplatePayload["account_approved"];
      return {
        subject: "RateMyOfficial account approved",
        html: layout(
          "Account approved",
          `<p>Hello ${escapeHtml(value.firstName)},</p><p>Your RateMyOfficial account has been approved. You can now sign in.</p>${linkHtml("Sign in to RateMyOfficial", value.loginUrl)}`,
        ),
        text: `Hello ${textValue(value.firstName)},\n\nYour RateMyOfficial account has been approved. You can now sign in.${value.loginUrl ? `\n\nSign in: ${textValue(value.loginUrl)}` : ""}`,
        metadata: { type, privacy: "transactional" },
      };
    }
    case "account_rejected": {
      const value = data as EmailTemplatePayload["account_rejected"];
      return {
        subject: "RateMyOfficial account status",
        html: layout(
          "Account status",
          `<p>Hello ${escapeHtml(value.firstName)},</p><p>Your RateMyOfficial account application was not approved at this time.</p>${linkHtml("Contact support", value.supportUrl)}`,
        ),
        text: `Hello ${textValue(value.firstName)},\n\nYour RateMyOfficial account application was not approved at this time.${value.supportUrl ? `\n\nContact support: ${textValue(value.supportUrl)}` : ""}`,
        metadata: { type, privacy: "transactional" },
      };
    }
    case "evaluation_submitted": {
      const value = data as EmailTemplatePayload["evaluation_submitted"];
      if (value.audience === "reviewer") {
        const summary = `${value.coachName || "A coach"} submitted an evaluation for ${value.officialName} at ${value.eventName}.`;
        const status = value.isPending ? "The evaluation is pending account approval." : "The evaluation has been received.";
        return {
          subject: "RateMyOfficial evaluation submitted",
          html: layout("Evaluation submitted",
            `<p>Hello ${escapeHtml(value.firstName)},</p><p>${escapeHtml(summary)}</p><p>${status}</p>${linkHtml("View event", value.reviewUrl)}`),
          text: `Hello ${textValue(value.firstName)},\n\n${textValue(summary)}\n${status}${value.reviewUrl ? `\n\nView event: ${textValue(value.reviewUrl)}` : ""}`,
          metadata: { type, privacy: "transactional" },
        };
      }
      const status = value.isPending
        ? "Your evaluation was received successfully and is pending account approval."
        : "Your evaluation was received successfully.";
      return {
        subject: "RateMyOfficial evaluation received",
        html: layout(
          "Evaluation received",
          `<p>Hello ${escapeHtml(value.firstName)},</p><p>Thank you for submitting an evaluation to RateMyOfficial.</p><p>Your evaluation for ${escapeHtml(value.officialName)} at ${escapeHtml(value.eventName)} ${value.isPending ? "was received successfully and is pending account approval." : "was received successfully."}</p>${linkHtml("View RateMyOfficial", value.reviewUrl)}`,
        ),
        text: `Hello ${textValue(value.firstName)},\n\nThank you for submitting an evaluation to RateMyOfficial.\n\nYour evaluation for ${textValue(value.officialName)} at ${textValue(value.eventName)} ${status}${value.reviewUrl ? `\n\nView RateMyOfficial: ${textValue(value.reviewUrl)}` : ""}`,
        metadata: { type, privacy: "transactional" },
      };
    }
    case "password_reset": {
      const value = data as EmailTemplatePayload["password_reset"];
      return {
        subject: "Reset your RateMyOfficial password",
        html: layout(
          "Password reset",
          `<p>A password reset was requested for your RateMyOfficial account.</p><p>Use the link below to set a new password. This link expires in ${value.expiresInMinutes} minutes and can be used once.</p>${linkHtml("Reset password", value.resetUrl)}<p>If you did not request this reset, you may ignore this email.</p>`,
        ),
        text: `A password reset was requested for your RateMyOfficial account.\n\nUse the link below to set a new password. This link expires in ${value.expiresInMinutes} minutes and can be used once.\n\nReset password: ${textValue(value.resetUrl)}\n\nIf you did not request this reset, you may ignore this email.`,
        metadata: { type, privacy: "transactional" },
      };
    }
    case "controlled_delivery_test": {
      return {
        subject: "RateMyOfficial email delivery test",
        html: layout(
          "Email delivery test",
          "<p>This is an authorized RateMyOfficial transactional email delivery test.</p><p>No action is required.</p>",
        ),
        text: "This is an authorized RateMyOfficial transactional email delivery test.\n\nNo action is required.",
        metadata: { type, privacy: "transactional" },
      };
    }
    case "event_created":
    case "event_reminder": {
      const value = data as EmailTemplatePayload["event_created"];
      const isReminder = type === "event_reminder";
      const isFollowUp = isReminder && value.reminderKind === "day_after";
      const title = isFollowUp ? "Evaluation reminder" : isReminder ? "Event reminder" : "Event assignment";
      const intro = isReminder
        ? isFollowUp
          ? "You have not yet submitted an evaluation for this event. Please sign in to submit one."
          : "Your school has an event today. Please remember to submit an evaluation."
        : "An event assignment for your school has been created or updated.";
      return {
        subject: isFollowUp ? "RateMyOfficial evaluation reminder" : isReminder
          ? "RateMyOfficial event reminder"
          : "RateMyOfficial event assigned",
        html: layout(
          title,
          `<p>Hello ${escapeHtml(value.firstName)},</p><p>${intro}</p><p><strong>${escapeHtml(value.eventName)}</strong><br>Start: ${escapeHtml(value.eventStart)}<br>Venue: ${escapeHtml(value.venue)}</p><p>Officials:</p>${officialsHtml(value.assignedOfficials)}${linkHtml("View event", value.eventUrl)}`,
        ),
        text: `Hello ${textValue(value.firstName)},\n\n${intro}\n\n${textValue(value.eventName)}\nStart: ${textValue(value.eventStart)}\nVenue: ${textValue(value.venue)}\nOfficials: ${officialsText(value.assignedOfficials)}${value.eventUrl ? `\n\nView event: ${textValue(value.eventUrl)}` : ""}`,
        metadata: { type, privacy: "transactional" },
      };
    }
  }

  throw new Error("Unsupported email template type");
}

export function validateStoredTemplate(
  row: Pick<EmailOutbox, "type" | "payload">,
): void {
  if (!emailOutboxTypes.includes(row.type as EmailTemplateType)) {
    throw new Error("Unsupported email template type");
  }
  parseTemplatePayload(row.type as EmailTemplateType, row.payload);
}
