import type { Request } from "express";
import formidable, { type Fields, type Files, type File } from "formidable";
import os from "os";

type ParsedMultipart = { fields: Fields; files: Files };

function parse(
  req: Request,
  maxFileSize: number,
  acceptsMime: (mime: string) => boolean,
): Promise<ParsedMultipart> {
  const form = formidable({
    maxFileSize,
    uploadDir: os.tmpdir(),
    keepExtensions: true,
    maxFiles: 1,
    multiples: false,
    allowEmptyFiles: false,
    filter: ({ name, mimetype }) => !name || Boolean(mimetype && acceptsMime(mimetype)),
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) return reject(error);
      resolve({ fields, files });
    });
  });
}

export function parseImageMultipart(req: Request, maxFileSize: number): Promise<ParsedMultipart> {
  return parse(req, maxFileSize, (mime) => mime.startsWith("image/"));
}

export function parseVideoMultipart(req: Request, maxFileSize: number): Promise<ParsedMultipart> {
  return parse(req, maxFileSize, (mime) => mime.startsWith("video/") || mime === "application/octet-stream");
}

export function firstFile(files: Files, field: string): File | undefined {
  const value = files[field];
  return Array.isArray(value) ? value[0] : value;
}