import { pool } from "../server/db";

// Read-only monitoring: no addresses, payloads, tokens or credentials.
try {
  const result = await pool.query(`
    SELECT type, status, count(*)::int AS count,
      count(*) FILTER (WHERE status = 'processing'
        AND claimed_at < now() - interval '5 minutes')::int AS stale_claims,
      count(*) FILTER (WHERE status IN ('pending','retry_wait')
        AND scheduled_for <= now() AND next_attempt_at <= now())::int AS due
    FROM email_outbox GROUP BY type,status ORDER BY type,status`);
  console.log(JSON.stringify(result.rows, null, 2));
} catch {
  console.error("Email status unavailable");
  process.exitCode = 1;
} finally {
  await pool.end();
}
