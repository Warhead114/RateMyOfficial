import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrustedResetUrl,
  hashPasswordResetToken,
  PasswordResetRateLimiter,
} from "../server/auth/password-reset";

test("reset links use only the trusted application base URL", () => {
  const token = "a".repeat(43);
  const resetUrl = new URL(
    buildTrustedResetUrl("https://trusted.example.test/application", token),
  );
  assert.equal(resetUrl.origin, "https://trusted.example.test");
  assert.equal(resetUrl.pathname, "/reset-password");
  assert.equal(resetUrl.searchParams.get("token"), token);
  assert.equal(resetUrl.searchParams.size, 1);

  assert.throws(() => buildTrustedResetUrl("javascript:alert(1)", token));
  assert.throws(() =>
    buildTrustedResetUrl("https://user:password@example.test", token),
  );
});

test("reset tokens are one-way hashed and limiter issuance is bounded", () => {
  const token = Buffer.alloc(32, 71).toString("base64url");
  const hash = hashPasswordResetToken(token);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.doesNotMatch(hash, new RegExp(token));

  const limiter = new PasswordResetRateLimiter(2, 1_000, 2);
  assert.equal(limiter.allow("first", 1_000), true);
  assert.equal(limiter.allow("first", 1_001), true);
  assert.equal(limiter.allow("first", 1_002), false);
  assert.equal(limiter.allow("second", 1_003), true);
  assert.equal(limiter.allow("third", 1_004), true);
  assert.equal(limiter.allow("first", 1_005), true);
});