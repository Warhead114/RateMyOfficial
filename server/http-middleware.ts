import type { ErrorRequestHandler, RequestHandler } from "express";
import { STATUS_CODES } from "node:http";

// Sample memory opportunistically, at most once per 30 seconds. There are no
// recurring timers, forced collections, or work required to finish a request.
export function createRequestLogger(
  writeLog: (message: string) => void,
  {
    now = Date.now,
    memoryUsage = process.memoryUsage,
    warn = console.warn,
  } = {},
): RequestHandler {
  let lastMemoryCheck = -Infinity;
  let lastMemoryWarning = -Infinity;
  return (req, res, next) => {
    const start = now();
    const isApi = /^\/api(?:\/|$)/i.test(req.path);
    res.once("finish", () => {
      const finished = now();
      if (isApi) {
        // Route templates retain useful diagnostics without recording query
        // strings, arbitrary path values, headers, cookies or request bodies.
        const route = typeof req.route?.path === "string"
          ? req.route.path
          : "/api/[unmatched]";
        writeLog(`${req.method} ${route} ${res.statusCode} ${finished - start}ms`);
      }
      if (finished - lastMemoryCheck >= 30_000) {
        lastMemoryCheck = finished;
        const usage = memoryUsage();
        if (usage.heapUsed > 512 * 1024 * 1024 &&
            finished - lastMemoryWarning >= 60_000) {
          lastMemoryWarning = finished;
          warn("High memory usage detected:", {
            heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
            rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
          });
        }
      }
    });
    next();
  };
}

export const requestErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const candidate = err?.status || err?.statusCode;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
  const message = process.env.NODE_ENV === "production"
    ? STATUS_CODES[status] || "Request failed"
    : err?.message || STATUS_CODES[status] || "Request failed";
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ message });
  // Do not log error messages/stacks: parser/static errors may contain secrets.
  console.error("Request failed", { status });
};

// Defense in depth if a historical export is accidentally copied into a
// public directory. This applies before either Vite or Production static files.
export const blockSourceArchives: RequestHandler = (req, res, next) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(req.path).replaceAll("\\", "/");
  } catch (error) {
    next(Object.assign(error as Error, { status: 400 }));
    return;
  }
  if (/(?:^|\/)(?:app-code\.zip|app-source-code\.zip|RateMyOfficial-source[^/]*\.zip(?:\.part-[^/]*)?|node_modules-part-\d+\.zip)(?:\/|$)/i.test(pathname)) {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ message: "Not found" });
    return;
  }
  next();
};
