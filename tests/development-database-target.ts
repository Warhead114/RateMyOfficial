import assert from "node:assert/strict";

// The caller must first obtain the expected name from the platform's explicit
// Development database inspection. No default or Production-shaped target.
export async function assertDevelopmentDatabase(pool: { query: Function }) {
  const expected = process.env.TEST_DEVELOPMENT_DATABASE;
  assert.ok(expected, "Set TEST_DEVELOPMENT_DATABASE after verifying the Development target");
  assert.notEqual(process.env.NODE_ENV, "production", "Database tests may not run in Production");
  assert.equal(process.env.SKIP_DATABASE_INITIALIZATION, "1", "Tests must not run startup DDL");
  const result = await pool.query("SELECT current_database() AS name, current_setting('transaction_read_only') AS read_only");
  assert.equal(result.rows[0].name, expected, "Database target does not match verified Development identity");
  assert.equal(result.rows[0].read_only, "off");
}
