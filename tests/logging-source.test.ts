import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("server source does not regress to session or PII-bearing console logging", async () => {
  const [routes, storage] = await Promise.all([
    readFile("server/routes.ts", "utf8"),
    readFile("server/storage.ts", "utf8"),
  ]);
  const source = `${routes}\n${storage}`;

  assert.doesNotMatch(source, /sessionID/);
  assert.doesNotMatch(
    source,
    /console\.(?:log|error|warn)\([^\n]*(?:req\.user|\.email|schoolName|filepath|\.stack)/,
  );
  assert.doesNotMatch(storage, /result\.map\(u\s*=>\s*\(\{\s*id:\s*u\.id,\s*email:/);

  for (const route of [
    "/api/auth/register",
    "/api/users/profile",
    "/api/admin/coaches",
    "/api/supervisor/coaches",
    "/api/events",
  ]) {
    const start = routes.indexOf(`"${route}`);
    assert.notEqual(start, -1);
    const nextRoute = routes.indexOf("\n    app.", start + route.length);
    const handler = routes.slice(start, nextRoute === -1 ? undefined : nextRoute);
    assert.doesNotMatch(handler, /console\.(?:log|error|warn)\(/);
  }
});