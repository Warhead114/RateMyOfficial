// OFFLINE operator tool only. No GitHub/Replit execution, network or stdout data.
import { constants, createDecipheriv, createHash, createPrivateKey,
  createPublicKey, privateDecrypt } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSealedReport } from "./email-report-crypto.mjs";

export function decryptReport(envelope, keyData) {
  let contentKey, plaintext;
  try {
    const key = createPrivateKey(keyData);
    const fingerprint = createHash("sha256").update(
      createPublicKey(key).export({ type: "spki", format: "der" })).digest("hex");
    validateSealedReport(envelope, fingerprint);
    const aad = Buffer.from("RateMyOfficial/email-validation-report/v1");
    contentKey = privateDecrypt({ key, oaepHash: "sha256", oaepLabel: aad,
      padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.wrappedKey, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(envelope.iv, "base64"));
    cipher.setAAD(aad); cipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    plaintext = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, "base64")), cipher.final()]);
    return JSON.parse(plaintext.toString());
  } catch { throw new Error("Offline decryption refused"); }
  finally { contentKey?.fill(0); plaintext?.fill(0); }
}
async function main() {
  if (process.env.GITHUB_ACTIONS || process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN ||
    process.argv.length !== 5) throw new Error();
  const [input, keyPath, output] = process.argv.slice(2).map(p => resolve(p));
  const keyStat = await lstat(keyPath), parent = await lstat(dirname(output)), report = await lstat(input);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || (keyStat.mode & 0o077) || keyStat.size > 16384 ||
    !parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) ||
    !report.isFile() || report.isSymbolicLink() || report.size > 4 * 1024 * 1024) throw new Error();
  const key = await readFile(keyPath);
  try {
    const result = decryptReport(JSON.parse(await readFile(input, "utf8")), key);
    await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600, flag: "wx" });
  } finally { key.fill(0); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Offline decryption refused.");
    process.exitCode = 1;
  });
}
