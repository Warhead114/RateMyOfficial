import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
import sharp from "sharp";

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_DURATION_SECONDS = 30;
const uploadsDirectory = path.resolve(process.cwd(), "uploads");
const execFile = promisify(execFileCallback);

export class UploadError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "UploadError";
  }
}

type UploadedFile = { filepath: string; size: number; mimetype?: string | null };
export type SavedAsset = { url: string; filename: string };

function containedPath(filename: string): string {
  const destination = path.resolve(uploadsDirectory, filename);
  if (path.dirname(destination) !== uploadsDirectory) {
    throw new UploadError("Invalid upload path");
  }
  return destination;
}

async function removeIfPresent(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/**
 * Stores a validated upload under the only public upload directory. Source
 * files are always removed, including when validation or conversion fails.
 */
export async function saveImage(file: UploadedFile): Promise<SavedAsset> {
  let destination: string | undefined;
  try {
    if (file.size > IMAGE_MAX_BYTES) throw new UploadError("Image file is too large. Maximum size is 10 MiB.");
    if (file.size <= 0) throw new UploadError("Image file is empty.");

    // sharp decodes the bytes, rather than trusting the client MIME/type.
    const image = sharp(file.filepath, { failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format) throw new UploadError("Uploaded file is not a supported image.");

    const filename = `${randomUUID()}.jpg`;
    destination = containedPath(filename);
    await fs.mkdir(uploadsDirectory, { recursive: true });
    await image.rotate().jpeg({ quality: 85, mozjpeg: true }).toFile(destination);
    return { filename, url: `/uploads/${filename}` };
  } catch (error) {
    if (destination) await removeIfPresent(destination);
    if (error instanceof UploadError) throw error;
    throw new UploadError("Uploaded file is not a supported image.");
  } finally {
    await removeIfPresent(file.filepath);
  }
}

function videoExtension(bytes: Buffer): ".mp4" | ".webm" | ".mov" | ".avi" | undefined {
  // ISO base media (MP4/MOV) has "ftyp" at byte offset 4.
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase();
    return brand === "qt  " ? ".mov" : ".mp4";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.length >= 12 && bytes.subarray(8, 12).toString("ascii") === "AVI ") return ".avi";
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return ".webm";
  return undefined;
}

async function probeVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      {
        maxBuffer: 1024,
        timeout: 10_000,
        killSignal: "SIGKILL",
      },
    );
    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Video duration metadata is missing or invalid.");
    }
    return duration;
  } catch {
    throw new UploadError("Unable to verify video duration. Please upload a playable video.");
  }
}

export async function saveVideo(file: UploadedFile): Promise<SavedAsset> {
  let destination: string | undefined;
  try {
    if (file.size > VIDEO_MAX_BYTES) throw new UploadError("Video file is too large. Maximum size is 50 MiB.");
    if (file.size <= 0) throw new UploadError("Video file is empty.");
    const handle = await fs.open(file.filepath, "r");
    const bytes = Buffer.alloc(32);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    await handle.close();
    const extension = videoExtension(bytes.subarray(0, bytesRead));
    if (!extension) throw new UploadError("Uploaded file is not a supported MP4, WebM, QuickTime, or AVI video.");

    const duration = await probeVideoDuration(file.filepath);
    if (duration > VIDEO_MAX_DURATION_SECONDS) {
      throw new UploadError(
        `Video file is too long. Maximum duration is ${VIDEO_MAX_DURATION_SECONDS} seconds.`,
      );
    }

    const filename = `${randomUUID()}${extension}`;
    destination = containedPath(filename);
    await fs.mkdir(uploadsDirectory, { recursive: true });
    // Copy supports temp directories mounted on a different filesystem; the
    // finally block removes the source after a successful copy.
    await fs.copyFile(file.filepath, destination);
    destination = undefined; // retain the saved asset below.
    return { filename, url: `/uploads/${filename}` };
  } catch (error) {
    if (destination) await removeIfPresent(destination);
    if (error instanceof UploadError) throw error;
    throw new UploadError("Unable to store uploaded video.", 500);
  } finally {
    await removeIfPresent(file.filepath);
  }
}

/** Deletes only canonical URLs that resolve beneath the uploads directory. */
export async function deleteAsset(url: string | null | undefined): Promise<void> {
  if (!url || !url.startsWith("/uploads/")) return;
  const filename = url.slice("/uploads/".length);
  if (!/^[0-9a-f-]{36}\.(?:jpg|mp4|webm|mov|avi)$/.test(filename)) return;
  await removeIfPresent(containedPath(filename));
}