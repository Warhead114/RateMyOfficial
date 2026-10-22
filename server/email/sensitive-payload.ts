import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { EmailTemplateType } from "./templates";

/**
 * Future password-reset integration boundary.
 *
 * Task 17 must provide an authenticated-encryption implementation backed by a
 * dedicated Production secret. The email outbox intentionally has no default
 * or plaintext implementation.
 */
export interface SensitiveEmailPayloadProtector {
  seal(type: EmailTemplateType, payload: Record<string, unknown>): Promise<string>;
  open(type: EmailTemplateType, ciphertext: string): Promise<Record<string, unknown>>;
}

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function associatedData(type: EmailTemplateType): Buffer {
  return Buffer.from(`ratemyofficial:email:${VERSION}:${type}`, "utf8");
}

export function parseSensitivePayloadKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) {
    throw new Error("EMAIL_SENSITIVE_PAYLOAD_KEY is required");
  }
  const key = /^[0-9a-f]{64}$/i.test(encodedKey)
    ? Buffer.from(encodedKey, "hex")
    : Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("EMAIL_SENSITIVE_PAYLOAD_KEY must encode exactly 32 bytes");
  }
  return key;
}

export class AesGcmSensitiveEmailPayloadProtector
implements SensitiveEmailPayloadProtector {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("Sensitive email payload key must be 32 bytes");
    }
  }

  async seal(
    type: EmailTemplateType,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(associatedData(type));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  async open(
    type: EmailTemplateType,
    sealed: string,
  ): Promise<Record<string, unknown>> {
    const [version, ivValue, tagValue, ciphertextValue, extra] = sealed.split(".");
    if (
      version !== VERSION ||
      extra !== undefined ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue
    ) {
      throw new Error("Unsupported sensitive payload envelope");
    }
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
      throw new Error("Invalid sensitive payload envelope");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAAD(associatedData(type));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid sensitive payload");
    }
    return parsed as Record<string, unknown>;
  }
}

export function sensitiveEmailPayloadProtectorFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): SensitiveEmailPayloadProtector {
  return new AesGcmSensitiveEmailPayloadProtector(
    parseSensitivePayloadKey(env.EMAIL_SENSITIVE_PAYLOAD_KEY),
  );
}

export class UnconfiguredSensitiveEmailPayloadProtector
implements SensitiveEmailPayloadProtector {
  async seal(): Promise<string> {
    throw new Error("Sensitive email payload protection is not configured");
  }

  async open(): Promise<Record<string, unknown>> {
    throw new Error("Sensitive email payload protection is not configured");
  }
}
