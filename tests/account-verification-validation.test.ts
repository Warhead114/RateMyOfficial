import assert from "node:assert/strict";
import test from "node:test";
import { verifyUserStatusSchema } from "../shared/schema";

test("account verification accepts only literal boolean decisions", () => {
  assert.deepEqual(verifyUserStatusSchema.parse({ approved: true }), {
    approved: true,
  });
  assert.deepEqual(verifyUserStatusSchema.parse({ approved: false }), {
    approved: false,
  });

  const invalidBodies = [
    {},
    { approved: null },
    { approved: "false" },
    { approved: "true" },
    { approved: 0 },
    { approved: 1 },
    { approved: [] },
    { approved: {} },
    { approved: false, unexpected: true },
  ];
  for (const body of invalidBodies) {
    assert.equal(verifyUserStatusSchema.safeParse(body).success, false);
  }
});