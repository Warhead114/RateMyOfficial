// No dependencies, private keys, environment reads, logging or network access.
import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt,
  randomBytes, timingSafeEqual } from "node:crypto";
import { open, link, unlink } from "node:fs/promises";

const refuse = () => { throw new Error("Sealed report refused"); };
const aad = Buffer.from("RateMyOfficial/email-validation-report/v1");
const maximumReportBytes = 2 * 1024 * 1024;
export const reportFilename = "report.enc.json";

export function reportPublicKey(pem, fingerprint) {
  try {
    if (typeof pem !== "string" || pem.length > 8192 ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n/.test(pem) || pem.includes("PRIVATE KEY") ||
      !/^[a-f0-9]{64}$/.test(fingerprint || "")) refuse();
    const key = createPublicKey(pem);
    const bits = key.asymmetricKeyDetails?.modulusLength;
    if (key.asymmetricKeyType !== "rsa" || ![3072, 4096, 6144, 8192].includes(bits)) refuse();
    const actual = createHash("sha256").update(
      key.export({ type: "spki", format: "der" })).digest();
    if (!timingSafeEqual(actual, Buffer.from(fingerprint, "hex"))) refuse();
    return { key, fingerprint };
  } catch { refuse(); }
}

export function sealReport(value, recipient) {
  let plaintext, contentKey;
  try {
    plaintext = Buffer.from(JSON.stringify(value));
    if (!plaintext.length || plaintext.length > maximumReportBytes) refuse();
    contentKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = publicEncrypt({ key: recipient.key, oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING, oaepLabel: aad }, contentKey);
    return { version: 1, algorithm: "RSA-OAEP-SHA256+A256GCM",
      keyFingerprint: recipient.fingerprint, wrappedKey: wrappedKey.toString("base64"),
      iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64") };
  } catch { refuse(); }
  finally { plaintext?.fill(0); contentKey?.fill(0); }
}

export function validateSealedReport(envelope, fingerprint) {
  try {
    const names = ["version", "algorithm", "keyFingerprint", "wrappedKey", "iv", "tag", "ciphertext"];
    if (!envelope || Object.keys(envelope).sort().join() !== names.sort().join() ||
      envelope.version !== 1 || envelope.algorithm !== "RSA-OAEP-SHA256+A256GCM" ||
      !/^[a-f0-9]{64}$/.test(fingerprint || "") || envelope.keyFingerprint !== fingerprint) refuse();
    const decode = name => {
      const text = envelope[name];
      if (typeof text !== "string" || text.length > maximumReportBytes * 2) refuse();
      const data = Buffer.from(text, "base64");
      if (!data.length || data.toString("base64") !== text) refuse();
      return data;
    };
    if (decode("iv").length !== 12 || decode("tag").length !== 16 ||
      ![384, 512, 768, 1024].includes(decode("wrappedKey").length) ||
      decode("ciphertext").length > maximumReportBytes) refuse();
    return true;
  } catch { refuse(); }
}

// Publish only a complete sealed envelope. Never put plaintext in either file.
export async function writeSealedReport(directory, value, recipient) {
  const envelope = sealReport(value, recipient);
  validateSealedReport(envelope, recipient.fingerprint);
  const temporary = `${directory}/.sealed-report.tmp`;
  let handle, created = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    created = true;
    await handle.writeFile(JSON.stringify(envelope));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, `${directory}/${reportFilename}`);
  } catch { refuse(); }
  finally {
    await handle?.close().catch(() => {});
    if (created) await unlink(temporary).catch(() => {});
  }
}
