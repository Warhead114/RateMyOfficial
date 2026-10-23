import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import express from "express";
import { registerAdminRegionRoutes } from "../server/admin-regions";

test("both region-control screens use the supported current-user API contract", async () => {
  for (const file of ["manage-coaches", "manage-teams"]) {
    const source = await readFile(new URL(`../client/src/pages/admin/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /queryKey:\s*\["\/api\/auth\/me"\]/);
    assert.doesNotMatch(source, /\/api\/auth\/user/);
  }
});

test("explicit administrator-only region assignment", async (t) => {
  const writes: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("x-fixture-role");
    req.isAuthenticated = (() => Boolean(role)) as typeof req.isAuthenticated;
    req.user = role ? { role } as Express.User : undefined;
    next();
  });
  registerAdminRegionRoutes(app, {
    getUserById: async (id) => id === 1 ? { id, userType: "Coach" } as any :
      id === 3 ? { id, userType: "Regional Supervisor" } as any : undefined,
    getTeamById: async (id) => id === 2 ? { id, name: "Existing team" } as any : undefined,
    updateUserProfile: async (id, updates, approval) => {
      writes.push({ id, updates, approval });
      return { id, ...updates } as any;
    },
    updateTeam: async (id, updates) => {
      writes.push({ id, updates });
      return { id, ...updates } as any;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const patch = (url: string, body: unknown, role?: string) => fetch(base + url, {
    method: "PATCH", headers: { "content-type": "application/json", ...(role ? { "x-fixture-role": role } : {}) },
    body: JSON.stringify(body),
  });
  try {
    await t.test("anonymous, coach and regional supervisor cannot assign either region", async () => {
      for (const [resource, id] of [["coaches", 1], ["teams", 2]]) {
        for (const role of [undefined, "user", "supervisor"]) {
          const result = await patch(`/api/admin/${resource}/${id}/region`, { region: "West" }, role);
          assert.equal(result.status, role ? 403 : 401);
        }
      }
      assert.equal(writes.length, 0);
    });
    await t.test("explicit trimmed coach region never grants notification approval", async () => {
      const response = await patch("/api/admin/coaches/1/region", { region: " West " }, "admin");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: 1, region: "West" });
      assert.deepEqual(writes.pop(), { id: 1, updates: { region: "West" }, approval: false });
    });
    await t.test("team region save touches only the specified field", async () => {
      const response = await patch("/api/admin/teams/2/region", { region: "East" }, "admin");
      assert.equal(response.status, 200);
      assert.deepEqual(writes.pop(), { id: 2, updates: { region: "East" } });
    });
    await t.test("missing, empty, oversized, inferred or approval fields are rejected", async () => {
      for (const body of [{}, { region: "" }, { region: "  " }, { region: null },
        { region: "x".repeat(121) }, { region: "East", isVerified: true },
        { region: "East", approveEventIdentity: true }, { supervisorId: 1 }]) {
        assert.equal((await patch("/api/admin/coaches/1/region", body, "admin")).status, 400);
      }
      assert.equal(writes.length, 0);
    });
    await t.test("invalid IDs, missing targets and non-coaches cannot be assigned", async () => {
      for (const id of ["-1", "0", "1x", "9007199254740992"]) {
        assert.equal((await patch(`/api/admin/teams/${id}/region`, { region: "East" }, "admin")).status, 400);
      }
      for (const path of ["/api/admin/coaches/2/region", "/api/admin/coaches/3/region", "/api/admin/teams/4/region"]) {
        assert.equal((await patch(path, { region: "East" }, "admin")).status, 404);
      }
      assert.equal(writes.length, 0);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
