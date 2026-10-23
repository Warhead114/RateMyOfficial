// Upload gate: inspect only the one sealed envelope, never display its contents.
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reportFilename, validateSealedReport } from "./email-report-crypto.mjs";

export async function checkArtifact(directory, fingerprint) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077)) throw new Error();
  const path = resolve(directory, reportFilename), file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) ||
    file.size > 4 * 1024 * 1024) throw new Error();
  validateSealedReport(JSON.parse(await readFile(path, "utf8")), fingerprint);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.env.RUNNER_TEMP || "", "email-validation-sealed");
  checkArtifact(directory, process.env.EMAIL_REPORT_KEY_SHA256).catch(() => {
    console.error("No verified sealed report is available.");
    process.exitCode = 1;
  });
}
