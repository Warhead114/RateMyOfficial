import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeLogContext } from "../server/logger";

test("logger redacts sensitive context keys", () => {
  assert.deepEqual(
    sanitizeLogContext({
      email: "coach@example.test",
      password: "not-safe",
      verificationToken: "not-safe",
      filepath: "/tmp/private",
      nested: { sessionCookie: "not-safe" },
      requestId: "safe",
    }),
    {
      email: "[REDACTED]",
      password: "[REDACTED]",
      verificationToken: "[REDACTED]",
      filepath: "[REDACTED]",
      nested: { sessionCookie: "[REDACTED]" },
      requestId: "safe",
    },
  );
});