import nodemailer from "nodemailer";
import {
  createEmailDeliveryPolicyFromEnv,
  normalizeEmailAddress,
  type EmailDeliveryPolicy,
} from "./policy";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  replyTo?: string | null;
  deadline?: Date | null;
  metadata?: Record<string, string>;
}

export interface ProviderSuccess {
  outcome: "success";
  providerMessageId?: string;
}

export interface ProviderFailure {
  outcome: "transient_failure" | "permanent_failure";
  errorCode: string;
  diagnostic: string;
}

export type EmailProviderResult = ProviderSuccess | ProviderFailure;

export interface EmailProvider {
  configurationFailure?(): ProviderFailure | null;
  send(message: EmailMessage): Promise<EmailProviderResult>;
}

const MAX_DIAGNOSTIC_LENGTH = 500;

export function sanitizeProviderDiagnostic(value: unknown): string {
  const diagnostic = value instanceof Error ? value.message : String(value);
  return diagnostic
    .replace(/[\r\n]+/g, " ")
    .replace(
      /(?:password|pass|secret|token|api[-_]?key)\s*=\s*[^,\s]+/gi,
      "credential=[REDACTED]",
    )
    .replace(/\bbearer\s+[a-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL_REDACTED]")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "[URL_REDACTED]")
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}

export function sanitizeProviderErrorCode(value: unknown): string {
  return String(value)
    .replace(/[^a-z0-9_.:-]/gi, "_")
    .slice(0, 100) || "EMAIL_PROVIDER_ERROR";
}

function providerErrorResult(error: unknown): ProviderFailure {
  const candidate = error as {
    code?: string;
    responseCode?: number;
    statusCode?: number;
    status?: number;
  };
  const numericCode = candidate.responseCode ?? candidate.statusCode ?? candidate.status;
  const code = sanitizeProviderErrorCode(
    candidate.code || (numericCode ? `SMTP_${numericCode}` : "SMTP_ERROR"),
  );
  const isTransient =
    numericCode === undefined ||
    numericCode >= 400 && numericCode < 500 ||
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EPIPE"].includes(code);

  return {
    outcome: isTransient ? "transient_failure" : "permanent_failure",
    errorCode: code,
    diagnostic: sanitizeProviderDiagnostic(error),
  };
}

export interface SmtpEmailProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  replyTo?: string | null;
  policy?: EmailDeliveryPolicy;
}

/**
 * An explicit SMTP adapter. Constructing it does not connect to the server;
 * connection and delivery happen only when send is called.
 */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: nodemailer.Transporter;
  private readonly policy: EmailDeliveryPolicy;

  constructor(private readonly config: SmtpEmailProviderConfig) {
    this.policy = config.policy ?? createEmailDeliveryPolicyFromEnv();
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: true,
      },
      requireTLS: !config.secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 60_000,
      debug: false,
      logger: false,
    });
  }

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    const authorization = this.policy.authorizeProviderMessage({
      recipientEmail: message.to,
      emailType: message.metadata?.type,
    });
    if (!authorization.allowed) {
      return {
        outcome: "permanent_failure",
        errorCode: "EMAIL_DELIVERY_BLOCKED",
        diagnostic: authorization.reason,
      };
    }
    const configurationFailure = this.configurationFailure();
    if (configurationFailure) return configurationFailure;

    if (message.deadline && message.deadline <= new Date()) {
      return {
        outcome: "permanent_failure",
        errorCode: "EXPIRED",
        diagnostic: "Message expired before SMTP delivery",
      };
    }

    let replyTo: string | undefined;
    if (message.replyTo) {
      try {
        replyTo = normalizeEmailAddress(message.replyTo);
      } catch {
        return {
          outcome: "permanent_failure",
          errorCode: "INVALID_REPLY_TO",
          diagnostic: "Reply-To address is invalid",
        };
      }
    } else if (this.config.replyTo) {
      try {
        replyTo = normalizeEmailAddress(this.config.replyTo);
      } catch {
        return {
          outcome: "permanent_failure",
          errorCode: "INVALID_REPLY_TO",
          diagnostic: "Configured Reply-To address is invalid",
        };
      }
    }

    try {
      const result = await this.transporter.sendMail({
        from: this.config.from,
        to: message.to,
        ...(replyTo ? { replyTo } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.metadata
          ? { "X-RateMyOfficial-Email-Type": message.metadata.type }
          : undefined,
      });
      return {
        outcome: "success",
        providerMessageId: result.messageId,
      };
    } catch (error) {
      return providerErrorResult(error);
    }
  }

  configurationFailure(): ProviderFailure | null {
    if (
      !this.config.host ||
      !this.config.user ||
      !this.config.password ||
      !this.config.from ||
      !Number.isInteger(this.config.port) ||
      this.config.port < 1 ||
      this.config.port > 65535
    ) {
      return {
        outcome: "permanent_failure",
        errorCode: "EMAIL_CONFIGURATION_INVALID",
        diagnostic: "SMTP configuration is invalid",
      };
    }
    return null;
  }
}

class FailClosedEmailProvider implements EmailProvider {
  constructor(private readonly reason: string) {}

  configurationFailure(): ProviderFailure {
    return {
      outcome: "permanent_failure",
      errorCode: "EMAIL_CONFIGURATION_MISSING",
      diagnostic: this.reason,
    };
  }

  async send(_message: EmailMessage): Promise<EmailProviderResult> {
    return this.configurationFailure();
  }
}

/**
 * Builds an SMTP adapter only from explicit configuration. It deliberately
 * does not fall back to Gmail or any other provider when configuration is
 * missing.
 */
export interface EmailProviderEnvironment {
  [key: string]: string | undefined;
  EMAIL_HOST?: string;
  EMAIL_USER?: string;
  EMAIL_PASSWORD?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_PORT?: string;
  EMAIL_SECURE?: string;
}

export function createSmtpEmailProviderFromEnv(
  env: EmailProviderEnvironment = process.env,
): EmailProvider {
  const host = env.EMAIL_HOST?.trim();
  const user = env.EMAIL_USER?.trim();
  const password = env.EMAIL_PASSWORD;
  const from = env.EMAIL_FROM?.trim() || user;
  const replyTo = env.EMAIL_REPLY_TO?.trim() || null;
  const rawPort = env.EMAIL_PORT?.trim() || "587";
  const port = Number.parseInt(rawPort, 10);
  const secure = env.EMAIL_SECURE === "true" || port === 465;

  if (!host || !user || !password || !from) {
    return new FailClosedEmailProvider(
      "Explicit SMTP host, sender, and credentials are required",
    );
  }

  if (from.includes("\r") || from.includes("\n")) {
    return new FailClosedEmailProvider("SMTP sender configuration is invalid");
  }

  if (replyTo) {
    try {
      normalizeEmailAddress(replyTo);
    } catch {
      return new FailClosedEmailProvider("SMTP Reply-To configuration is invalid");
    }
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return new FailClosedEmailProvider("SMTP port configuration is invalid");
  }

  return new SmtpEmailProvider({
    host,
    port,
    secure,
    user,
    password,
    from,
    replyTo,
    policy: createEmailDeliveryPolicyFromEnv(env),
  });
}

export interface PostmarkEmailProviderConfig {
  serverToken: string;
  from: string;
  replyTo?: string | null;
  messageStream?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  policy?: EmailDeliveryPolicy;
}

export interface PostmarkEmailProviderEnvironment extends EmailProviderEnvironment {
  POSTMARK_SERVER_TOKEN?: string;
  POSTMARK_MESSAGE_STREAM?: string;
}

const POSTMARK_ENDPOINT = "https://api.postmarkapp.com/email";
const DEFAULT_POSTMARK_MESSAGE_STREAM = "outbound";
const DEFAULT_POSTMARK_TIMEOUT_MS = 10_000;

function staticFailure(errorCode: string, diagnostic: string): ProviderFailure {
  return {
    outcome: "permanent_failure",
    errorCode,
    diagnostic,
  };
}

function postmarkFailure(
  status: number,
  diagnostic: string,
): ProviderFailure {
  const transient = status === 408 || status === 429 || status >= 500;
  return {
    outcome: transient ? "transient_failure" : "permanent_failure",
    errorCode: sanitizeProviderErrorCode(
      status === 429
        ? "POSTMARK_RATE_LIMITED"
        : status >= 500
          ? `POSTMARK_HTTP_${status}`
          : status === 401 || status === 403
            ? "POSTMARK_AUTHENTICATION"
            : `POSTMARK_HTTP_${status}`,
    ),
    diagnostic: sanitizeProviderDiagnostic(diagnostic || "Postmark request failed"),
  };
}

function parsePostmarkErrorBody(body: string): {
  errorCode?: number;
} {
  try {
    const parsed = JSON.parse(body) as {
      ErrorCode?: unknown;
    };
    return {
      errorCode: typeof parsed.ErrorCode === "number" ? parsed.ErrorCode : undefined,
    };
  } catch {
    return {};
  }
}

export class PostmarkEmailProvider implements EmailProvider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly messageStream: string;
  private readonly policy: EmailDeliveryPolicy;

  constructor(private readonly config: PostmarkEmailProviderConfig) {
    this.endpoint = config.endpoint ?? POSTMARK_ENDPOINT;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_POSTMARK_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.messageStream = config.messageStream ?? DEFAULT_POSTMARK_MESSAGE_STREAM;
    this.policy = config.policy ?? createEmailDeliveryPolicyFromEnv();
  }

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    const authorization = this.policy.authorizeProviderMessage({
      recipientEmail: message.to,
      emailType: message.metadata?.type,
    });
    if (!authorization.allowed) {
      return staticFailure("EMAIL_DELIVERY_BLOCKED", authorization.reason);
    }

    const configurationFailure = this.configurationFailure();
    if (configurationFailure) return configurationFailure;
    if (message.deadline && message.deadline <= new Date()) {
      return staticFailure("EXPIRED", "Message expired before Postmark delivery");
    }

    let replyTo: string | undefined;
    if (message.replyTo ?? this.config.replyTo) {
      try {
        replyTo = normalizeEmailAddress(message.replyTo ?? this.config.replyTo!);
      } catch {
        return staticFailure("INVALID_REPLY_TO", "Reply-To address is invalid");
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: Record<string, unknown> = {
        From: this.config.from,
        To: message.to,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        MessageStream: this.messageStream,
      };
      if (replyTo) {
        body.ReplyTo = replyTo;
      }
      const safeMetadata = message.metadata
        ? {
            type: message.metadata.type,
            privacy: message.metadata.privacy,
          }
        : undefined;
      if (safeMetadata?.type && safeMetadata.privacy) {
        body.Metadata = safeMetadata;
      }

      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": this.config.serverToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const responseBody = await response.text();
      const parsed = parsePostmarkErrorBody(responseBody);
      if (!response.ok) {
        return postmarkFailure(
          response.status,
          `Postmark request failed with HTTP ${response.status}${
            parsed.errorCode === undefined ? "" : ` and provider code ${parsed.errorCode}`
          }`,
        );
      }

      let responseJson: unknown;
      try {
        responseJson = JSON.parse(responseBody);
      } catch {
        return staticFailure(
          "POSTMARK_MALFORMED_RESPONSE",
          "Postmark response was not valid JSON",
        );
      }
      const providerMessageId =
        responseJson &&
        typeof responseJson === "object" &&
        "MessageID" in responseJson &&
        typeof responseJson.MessageID === "string"
          ? responseJson.MessageID.trim()
          : "";
      if (!providerMessageId) {
        return staticFailure(
          "POSTMARK_MALFORMED_RESPONSE",
          "Postmark response did not include a message ID",
        );
      }
      return { outcome: "success", providerMessageId };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          outcome: "transient_failure",
          errorCode: "POSTMARK_TIMEOUT",
          diagnostic: "Postmark request timed out",
        };
      }
      return {
        outcome: "transient_failure",
        errorCode: "POSTMARK_NETWORK_ERROR",
        diagnostic: sanitizeProviderDiagnostic(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  configurationFailure(): ProviderFailure | null {
    if (!this.config.serverToken || !this.config.from || !this.fetchImpl) {
      return staticFailure(
        "EMAIL_CONFIGURATION_MISSING",
        "Postmark server token, sender, and HTTP fetch are required",
      );
    }
    if (
      this.config.from.includes("\r") ||
      this.config.from.includes("\n") ||
      !this.messageStream ||
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs <= 0
    ) {
      return staticFailure(
        "EMAIL_CONFIGURATION_INVALID",
        "Postmark configuration is invalid",
      );
    }
    if (this.policy.mode === "controlled" && !this.config.replyTo) {
      return staticFailure(
        "EMAIL_CONFIGURATION_INVALID",
        "Controlled Postmark delivery requires an explicit Reply-To",
      );
    }
    if (this.config.replyTo) {
      try {
        normalizeEmailAddress(this.config.replyTo);
      } catch {
        return staticFailure(
          "EMAIL_CONFIGURATION_INVALID",
          "Postmark Reply-To configuration is invalid",
        );
      }
    }
    return null;
  }
}

export function createPostmarkEmailProviderFromEnv(
  env: PostmarkEmailProviderEnvironment = process.env,
  dependencies: Pick<PostmarkEmailProviderConfig, "fetchImpl"> = {},
): EmailProvider {
  const serverToken = env.POSTMARK_SERVER_TOKEN?.trim();
  const from = env.EMAIL_FROM?.trim();
  const replyTo = env.EMAIL_REPLY_TO?.trim() || null;
  const mode = env.EMAIL_DELIVERY_MODE?.trim().toLowerCase();
  const policy = createEmailDeliveryPolicyFromEnv(env);

  if (!serverToken || !from) {
    return new FailClosedEmailProvider(
      "Explicit Postmark server token and sender are required",
    );
  }
  if (from.includes("\r") || from.includes("\n")) {
    return new FailClosedEmailProvider("Postmark sender configuration is invalid");
  }
  if (replyTo) {
    try {
      normalizeEmailAddress(replyTo);
    } catch {
      return new FailClosedEmailProvider("Postmark Reply-To configuration is invalid");
    }
  }
  if (mode === "controlled" && !replyTo) {
    return new FailClosedEmailProvider(
      "Controlled Postmark delivery requires an explicit Reply-To",
    );
  }

  return new PostmarkEmailProvider({
    serverToken,
    from,
    replyTo,
    messageStream: env.POSTMARK_MESSAGE_STREAM?.trim() || DEFAULT_POSTMARK_MESSAGE_STREAM,
    fetchImpl: dependencies.fetchImpl,
    policy,
  });
}
