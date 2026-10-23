import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  IMAGE_MAX_BYTES,
  UploadError,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_SECONDS,
  deleteAsset,
  saveImage,
  saveVideo,
} from "../server/upload-service";

const temporaryFiles: string[] = [];
const createdUrls: string[] = [];
const execFile = promisify(execFileCallback);

async function temporary(contents: Buffer): Promise<string> {
  const file = path.join(os.tmpdir(), `upload-test-${Date.now()}-${Math.random()}`);
  temporaryFiles.push(file);
  await fs.writeFile(file, contents);
  return file;
}

async function temporaryVideo(durationSeconds: number): Promise<string> {
  const file = path.join(os.tmpdir(), `upload-test-${Date.now()}-${Math.random()}.mp4`);
  temporaryFiles.push(file);
  await execFile("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=16x16:r=1",
    "-t",
    durationSeconds.toString(),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    file,
  ]);
  return file;
}

afterEach(async () => {
  await Promise.all(temporaryFiles.splice(0).map(file => fs.unlink(file).catch(() => undefined)));
  await Promise.all(createdUrls.splice(0).map(deleteAsset));
});

test("images use generated canonical names and cannot traverse from a client path", async () => {
  const source = await temporary(await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer());
  const asset = await saveImage({ filepath: source, size: 100, mimetype: "image/png" });
  createdUrls.push(asset.url);
  assert.match(asset.url, /^\/uploads\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(await fs.access(source).then(() => true, () => false), false);
  assert.equal(asset.url.includes(".."), false);
});

test("deleteAsset refuses traversal URLs", async () => {
  const outside = await temporary(Buffer.from("must remain"));
  await deleteAsset(`/uploads/../${path.basename(outside)}`);
  assert.equal(await fs.readFile(outside, "utf8"), "must remain");
});

test("invalid and oversized images are rejected and their temporary files are removed", async () => {
  const invalid = await temporary(Buffer.from("not an image"));
  await assert.rejects(saveImage({ filepath: invalid, size: 12 }), UploadError);
  assert.equal(await fs.access(invalid).then(() => true, () => false), false);

  const tooLarge = await temporary(Buffer.from("x"));
  await assert.rejects(saveImage({ filepath: tooLarge, size: IMAGE_MAX_BYTES + 1 }), UploadError);
  assert.equal(await fs.access(tooLarge).then(() => true, () => false), false);
});

test("videos require recognized magic bytes, enforce size, and clean sources", async () => {
  const invalid = await temporary(Buffer.from("not a video"));
  await assert.rejects(saveVideo({ filepath: invalid, size: 11 }), UploadError);
  assert.equal(await fs.access(invalid).then(() => true, () => false), false);

  const unplayable = await temporary(Buffer.from("RIFF0000AVI "));
  await assert.rejects(saveVideo({ filepath: unplayable, size: 12 }), UploadError);
  assert.equal(await fs.access(unplayable).then(() => true, () => false), false);

  const tooLarge = await temporary(Buffer.from("RIFF0000AVI "));
  await assert.rejects(saveVideo({ filepath: tooLarge, size: VIDEO_MAX_BYTES + 1 }), UploadError);
  assert.equal(await fs.access(tooLarge).then(() => true, () => false), false);
});

test("videos at the duration boundary are accepted and longer videos are rejected before storage", async () => {
  const boundary = await temporaryVideo(VIDEO_MAX_DURATION_SECONDS);
  const boundaryAsset = await saveVideo({ filepath: boundary, size: (await fs.stat(boundary)).size });
  createdUrls.push(boundaryAsset.url);
  assert.equal(await fs.access(boundary).then(() => true, () => false), false);
  assert.equal(await fs.access(path.resolve("uploads", boundaryAsset.filename)).then(() => true, () => false), true);

  const tooLong = await temporaryVideo(VIDEO_MAX_DURATION_SECONDS + 1);
  await assert.rejects(
    saveVideo({ filepath: tooLong, size: (await fs.stat(tooLong)).size }),
    /Video file is too long/,
  );
  assert.equal(await fs.access(tooLong).then(() => true, () => false), false);
});