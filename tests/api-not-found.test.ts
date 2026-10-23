import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import express, { type Express } from "express";
import ts from "typescript";
import * as vite from "vite";
import { isAuthenticated, isAdmin } from "../server/auth/middleware";
import { blockSourceArchives } from "../server/http-middleware";

const require = createRequire(import.meta.url);
const archives = [
  "app-code.zip",
  "app-source-code.zip",
  "RateMyOfficial-source-updated-2026-08-30.zip",
  ...["00", "01", "02"].map(
    (part) => `RateMyOfficial-source-updated-2026-08-30.zip.part-${part}`,
  ),
  ...Array.from({ length: 8 }, (_, i) => `node_modules-part-${i + 1}.zip`),
];

// Execute the real source setup without importing the database, email services,
// production process handlers, recurring timers, or background jobs.
function loadCommonJs(
  source: string,
  dependencies: Record<string, unknown>,
  environment = "production",
) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => dependencies[name] ?? require(name),
    console: { ...console, error: () => {} },
    process: {
      env: { NODE_ENV: environment },
      cwd: () => process.cwd(),
    },
  });
  return module.exports;
}

test("API 404 boundary precedes real Development and Production frontend serving", async (t) => {
  const index = await fs.readFile("server/index.ts", "utf8");
  const serving = await fs.readFile("server/vite.ts", "utf8");
  const routes = await fs.readFile("server/routes.ts", "utf8");
  const uploadStart = routes.indexOf("    app.options('/uploads/*'");
  const uploadEnd = routes.indexOf("    // Health check endpoint", uploadStart);
  assert.ok(uploadStart >= 0 && uploadEnd > uploadStart);
  const registerUploadOptions = loadCommonJs(
    `module.exports = (app) => { ${routes.slice(uploadStart, uploadEnd)} };`,
    {},
  );
  const start = index.indexOf("  const server = await registerRoutes(app);");
  const end = index.indexOf(
    "  // Initialize the automatic experience updater",
    start,
  );
  assert.ok(start >= 0 && end > start, "actual startup setup must be located");
  const startup = index.slice(start, end);
  assert.ok(startup.indexOf('app.use("/api"') > 0);
  assert.ok(
    startup.indexOf('app.use("/api"') <
      startup.indexOf("app.use(requestErrorHandler)"),
    "API boundary must precede the terminal error handler",
  );
  assert.ok(
    startup.indexOf('app.use("/api"') < startup.indexOf("await setupVite"),
  );
  const boot = loadCommonJs(
    `async function boot(app, registerRoutes, setupVite, serveStatic, express, path, process, requestErrorHandler) {
      ${startup}
      return server;
    }
    module.exports = boot;`,
    {},
  );

  for (const mode of ["development", "production"]) {
    await t.test(mode, async (t) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "api-404-"));
      let devServer: vite.ViteDevServer | undefined;
      let httpServer: ReturnType<typeof createServer> | undefined;
      t.after(async () => {
        await devServer?.close();
        if (httpServer?.listening) {
          httpServer.closeAllConnections();
          await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
        }
        await fs.rm(root, { recursive: true, force: true });
      });
      for (const dir of ["client/public", "server/public"]) {
        await fs.mkdir(path.join(root, dir), { recursive: true });
      }
      await fs.mkdir(path.join(root, "uploads"));
      const videoName = "00000000-0000-4000-8000-000000000001.mp4";
      await fs.writeFile(path.join(root, "uploads", videoName), "0123456789");
      const template =
        '<!doctype html><html><body><div id="root">API audit SPA fixture</div>' +
        '<script type="module" src="/audit.js"></script></body></html>';
      await fs.writeFile(path.join(root, "client/index.html"), template);
      await fs.writeFile(path.join(root, "server/public/index.html"), template);
      for (const dir of ["client/public", "server/public"]) {
        await fs.writeFile(path.join(root, dir, "audit.js"), "/* public fixture */");
      }
      // Forbidden files exist outside public roots so denial is meaningful.
      for (const filename of [...archives, ".env"]) {
        await fs.writeFile(path.join(root, filename), "PRIVATE_ARCHIVE_FIXTURE");
      }
      // Also simulate accidental public copies: directory placement alone must
      // not be the only Production archive protection.
      for (const dir of ["client/public", "server/public"]) {
        for (const filename of archives) {
          await fs.writeFile(path.join(root, dir, filename), "PRIVATE_ARCHIVE_FIXTURE");
        }
      }
      const { setupVite, serveStatic } = loadCommonJs(
        serving.replaceAll(
          "import.meta.url",
          JSON.stringify(pathToFileURL(path.join(root, "server/vite.ts")).href),
        ),
        {
          "../vite.config": {
            root: path.join(root, "client"),
            plugins: [],
            cacheDir: path.join(root, "vite-cache"),
          },
          vite: {
            ...vite,
            createServer: async (options: vite.InlineConfig) => {
              devServer = await vite.createServer({
                ...options,
                server: {
                  ...options.server,
                  fs: { ...options.server?.fs, allow: [root] },
                },
              });
              const transform = devServer.transformIndexHtml.bind(devServer);
              devServer.transformIndexHtml = async (url, ...args) => {
                if (url === "/fixture-transform-error") {
                  throw Object.assign(new Error("PRIVATE_TEMPLATE_DETAIL"), { status: 503 });
                }
                return transform(url, ...args);
              };
              return devServer;
            },
          },
          nanoid: { nanoid: () => "fixture" },
          "./http-middleware": { blockSourceArchives },
        },
      );
      const app = express();
      app.set("env", mode);
      // Use the application's actual body-parser setup before route registration.
      const parserSetup = index.slice(
        index.indexOf("app.use(express.json());"),
        index.indexOf("app.use(createRequestLogger(log))"),
      );
      assert.ok(parserSetup.includes("express.urlencoded"));
      loadCommonJs(
        `module.exports = (app, express) => { ${parserSetup} };`,
        {},
      )(app, express);
      const registerFixtureRoutes = async (app: Express) => {
        registerUploadOptions(app);
        app.get("/api/health", (_req, res) => res.json({ status: "fixture" }));
        app.use((req, _res, next) => {
          req.isAuthenticated = (() =>
            req.get("x-fixture-auth") === "yes") as typeof req.isAuthenticated;
          next();
        });
        app.get("/api/coach/events", isAuthenticated, (_req, res) => res.json([]));
        app.get("/api/admin/coaches", isAuthenticated, isAdmin, (_req, res) =>
          res.json([]),
        );
        app.get("/api/fixture-error", (_req, _res, next) => {
          next(new Error("Private fixture error"));
        });
        app.get("/api/fixture-stream-error", (_req, res, next) => {
          res.write("STREAM_PREFIX");
          next(new Error("PRIVATE_STREAM_ERROR"));
        });
        app.get("/storage/fixture.jpg", (_req, res) =>
          res.type("jpg").send("photo fixture"),
        );
        httpServer = createServer(app);
        return httpServer;
      };
      const server = await boot(
        app, registerFixtureRoutes, setupVite, serveStatic, express, path,
        { env: { NODE_ENV: mode }, cwd: () => root },
        loadCommonJs(
          await fs.readFile("server/http-middleware.ts", "utf8"), {}, mode,
        ).requestErrorHandler,
      );
      let streamErrorForwarded = false;
      // Observe delegation after headers have been sent without logging the
      // private fixture error through Express's default final handler.
      app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (error.message === "PRIVATE_STREAM_ERROR") {
          assert.equal(res.headersSent, true);
          streamErrorForwarded = true;
          res.destroy();
        } else next(error);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const request = (url: string, options: RequestInit = {}) =>
        fetch(base + url, { ...options, signal: AbortSignal.timeout(15_000) });
      const assertNotFound = async (url: string, method = "GET") => {
        const response = await request(url, { method });
        assert.equal(response.status, 404, `${method} ${url}`);
        assert.match(response.headers.get("content-type") || "", /^application\/json/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("access-control-allow-origin"), null);
        assert.equal(
          await response.text(),
          method === "HEAD" ? "" : '{"message":"Not found"}',
        );
      };
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        await t.test(`unmatched API ${method}`, async () => {
          await assertNotFound("/api/__missing__", method);
        });
      }
      await t.test("API root, suspicious paths, query strings and trailing slash", async () => {
        for (const url of [
          "/api", "/api/", "/api/__missing__/?audit=1", "/api/.env",
          "/api/v1/.env", "/api/v2/.env", "/api/dev/.env",
        ]) {
          await assertNotFound(url);
        }
      });
      await t.test("known API, authentication, authorization and Object Storage routes", async () => {
        const health = await request("/api/health");
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { status: "fixture" });
        const unauthorized = await request("/api/coach/events");
        assert.equal(unauthorized.status, 401);
        assert.deepEqual(await unauthorized.json(), { message: "Unauthorized" });
        const authorized = await request("/api/coach/events", {
          headers: { "x-fixture-auth": "yes" },
        });
        assert.equal(authorized.status, 200);
        assert.deepEqual(await authorized.json(), []);
        const forbidden = await request("/api/admin/coaches", {
          headers: { "x-fixture-auth": "yes" },
        });
        assert.equal(forbidden.status, 403);
        assert.deepEqual(await forbidden.json(), { message: "Admin access required" });
        const photo = await request("/storage/fixture.jpg");
        assert.equal(photo.status, 200);
        assert.equal(await photo.text(), "photo fixture");
      });
      await t.test("malformed JSON and API errors retain the existing error handler", async () => {
        const malformed = await request("/api/__missing__", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        });
        assert.equal(malformed.status, 400);
        assert.match(malformed.headers.get("content-type") || "", /application\/json/);
        assert.notDeepEqual(await malformed.json(), { message: "Not found" });
        const error = await request("/api/fixture-error");
        assert.equal(error.status, 500);
        assert.deepEqual(await error.json(), {
          message: mode === "production" ? "Internal Server Error" : "Private fixture error",
        });
        await assert.rejects(async () => {
          const streaming = await request("/api/fixture-stream-error");
          await streaming.text();
        });
        assert.ok(streamErrorForwarded);
      });
      await t.test("frontend routes, API-prefix lookalikes and static assets", async () => {
        for (const url of ["/", "/officials", "/officials/fixture", "/apiary", "/apiary/nested"]) {
          const response = await request(url);
          assert.equal(response.status, 200, url);
          assert.match(response.headers.get("content-type") || "", /text\/html/);
          assert.match(await response.text(), /API audit SPA fixture/);
        }
        const asset = await request("/audit.js");
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get("content-type") || "", /javascript/);
        assert.match(await asset.text(), /public fixture/);
      });
      await t.test("actual upload whitelist and preflight remain unchanged", async () => {
        const preflight = await request("/uploads/fixture.jpg", { method: "OPTIONS" });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
        assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
        const forbiddenUpload = await request("/uploads/app-code.zip");
        assert.equal(forbiddenUpload.status, 404);
        const range = await request(`/uploads/${videoName}`, {
          headers: { range: "bytes=2-5" },
        });
        assert.equal(range.status, 206);
        assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
        assert.equal(range.headers.get("content-type"), "video/mp4");
        assert.equal(range.headers.get("access-control-allow-origin"), "*");
        assert.equal(await range.text(), "2345");
      });
      await t.test("known source archives and Development filesystem paths stay private", async () => {
        for (const name of archives) {
          for (const url of [
            `/${name}`, `/nested/${name}`, `/${name.replace(".", "%2e")}?download=1`,
            `/nested%2f${name}`, `/nested%5c${name}`,
            `/@fs/${path.join(root, name)}`,
          ]) {
            const response = await request(url);
            assert.equal(response.status, 404, url);
            assert.doesNotMatch(await response.text(), /PRIVATE_ARCHIVE_FIXTURE/);
          }
        }
        if (mode === "development") {
          for (const name of [".env"]) {
            const response = await request(`/@fs/${path.join(root, name)}`);
            assert.equal(response.status, 403, name);
            assert.doesNotMatch(await response.text(), /PRIVATE_ARCHIVE_FIXTURE/);
          }
        }
      });
      await t.test("upload decoding and late frontend errors reach the terminal handler", async () => {
        const upload = await request("/uploads/%ZZ.jpg");
        assert.equal(upload.status, 400);
        assert.match(upload.headers.get("content-type") || "", /application\/json/);
        if (mode === "development") {
          const response = await request("/fixture-transform-error");
          assert.equal(response.status, 503);
          assert.deepEqual(await response.json(), { message: "PRIVATE_TEMPLATE_DETAIL" });
        } else {
          await fs.unlink(path.join(root, "server/public/index.html"));
          const response = await request("/officials");
          assert.equal(response.status, 404);
          assert.deepEqual(await response.json(), { message: "Not Found" });
          assert.equal(response.headers.get("cache-control"), "no-store");
        }
      });
    });
  }
});
