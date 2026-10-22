import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Request, Response, NextFunction } from "express";
import {
  createRequestLogger, requestErrorHandler, blockSourceArchives,
} from "../server/http-middleware";

test("request logging is timer-free, immediate, bounded and redacts request values", async () => {
  const source = await readFile("server/http-middleware.ts", "utf8");
  const index = await readFile("server/index.ts", "utf8");
  assert.doesNotMatch(source, /setInterval|setTimeout|global\.gc/);
  assert.doesNotMatch(index, /setInterval|global\.gc/);
  let clock = 0;
  let samples = 0;
  let warnings = 0;
  const lines: string[] = [];
  const logger = createRequestLogger((line) => lines.push(line), {
    now: () => clock,
    memoryUsage: () => {
      samples++;
      return { heapUsed: 600 * 1024 * 1024, heapTotal: 700 * 1024 * 1024,
        rss: 800 * 1024 * 1024, external: 0, arrayBuffers: 0 };
    },
    warn: () => { warnings++; },
  });
  const complete = (requestPath: string, route?: string) => {
    const response = Object.assign(new EventEmitter(), { statusCode: 201 });
    let nextCalls = 0;
    logger({
      method: "POST", path: requestPath, route: route ? { path: route } : undefined,
      query: { token: "PRIVATE_QUERY" }, body: { password: "PRIVATE_BODY" },
      headers: { cookie: "PRIVATE_COOKIE", authorization: "PRIVATE_TOKEN" },
    } as unknown as Request, response as unknown as Response, () => { nextCalls++; });
    assert.equal(nextCalls, 1, "next must run without waiting for response/logging");
    clock += 2;
    response.emit("finish");
    assert.equal(response.listenerCount("finish"), 0);
  };
  complete("/api/officials/PRIVATE_ID", "/api/officials/:id");
  assert.equal(lines[0], "POST /api/officials/:id 201 2ms");
  for (let i = 0; i < 1000; i++) complete("/api/PRIVATE_PATH");
  assert.equal(samples, 1);
  assert.equal(warnings, 1);
  assert.doesNotMatch(lines.join("\n"), /PRIVATE_/);
  assert.match(lines[1], /\/api\/\[unmatched\]/);
  const count = lines.length;
  complete("/apiary");
  assert.equal(lines.length, count);
  clock = 30_001;
  complete("/");
  assert.equal(samples, 2);
  assert.equal(warnings, 1);
  clock = 60_010;
  complete("/");
  assert.equal(warnings, 2);
});

test("terminal error handler validates status, sanitizes Production errors and delegates sent headers", (t) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  const errors = [
    [new Error("PRIVATE_STACK_PATH_TOKEN"), 500, "Internal Server Error"],
    [Object.assign(new Error("PRIVATE_BODY"), { status: 400 }), 400, "Bad Request"],
    [{ statusCode: 404, message: "PRIVATE_FILE_PATH" }, 404, "Not Found"],
    [{ status: 200, message: "PRIVATE_DETAIL" }, 500, "Internal Server Error"],
    [{ status: 999 }, 500, "Internal Server Error"],
    [{ status: "403" }, 500, "Internal Server Error"],
    [null, 500, "Internal Server Error"],
  ] as const;
  for (const [error, expectedStatus, message] of errors) {
    const headers = new Map<string, string>();
    let status: number | undefined;
    let body: unknown;
    const response = {
      headersSent: false,
      setHeader: (key: string, value: string) => headers.set(key, value),
      status: (value: number) => { status = value; return response; },
      json: (value: unknown) => { body = value; },
    };
    requestErrorHandler(error, {} as Request, response as unknown as Response,
      () => assert.fail("unsent errors should be handled"));
    assert.equal(status, expectedStatus);
    assert.deepEqual(body, { message });
    assert.equal(headers.get("Cache-Control"), "no-store");
  }
  const error = new Error("already streaming");
  requestErrorHandler(error, {} as Request, { headersSent: true } as Response,
    (forwarded: unknown) => assert.equal(forwarded, error));
});

test("archive guard handles methods, encoded paths, historical variants and harmless lookalikes", () => {
  const blocked = [
    "/app-code.zip", "/nested/APP-SOURCE-CODE.ZIP",
    "/RateMyOfficial-source-future.zip.part-09",
    "/node_modules-part-8.zip", "/app-code%2ezip",
    "/nested%2fapp-code.zip", "/nested%5capp-code.zip",
  ];
  for (const method of ["GET", "HEAD", "OPTIONS", "POST"]) {
    for (const url of blocked) {
      let status: number | undefined;
      const response = {
        setHeader: () => {},
        status: (value: number) => { status = value; return response; },
        json: (value: unknown) => assert.deepEqual(value, { message: "Not found" }),
      };
      blockSourceArchives({ path: url, method } as Request, response as unknown as Response,
        () => assert.fail(url));
      assert.equal(status, 404, url);
    }
  }
  for (const url of ["/apiary", "/assets/app-code.zip.png", "/photos.zip", "/officials"]) {
    let passed = false;
    blockSourceArchives({ path: url } as Request, {} as Response, (() => { passed = true; }) as NextFunction);
    assert.ok(passed, url);
  }
});
