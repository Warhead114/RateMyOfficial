# Email infrastructure

The core email engine is intentionally separate from the application routes and
from the in-app `notifications` table.

## Runtime model

Business transactions will enqueue validated template payloads into
`email_outbox`. A separately triggered worker claims due rows with PostgreSQL
`FOR UPDATE SKIP LOCKED`, commits the claim, and calls an injected provider
outside the transaction. This task does not schedule or start that worker.

Delivery attempts are bounded. A stale processing lease consumes an attempt
when recovered so repeated crashes eventually reach the terminal `failed`
state. Status updates require the current random claim token, preventing a
stale worker from overwriting a row after its lease has been recovered.

Each claim also receives a random fencing token. Every renewal and final status
transition must match that token, so a stale worker cannot finalize a row after
another worker recovers it. Provider messages include the stable outbox
deduplication key for API adapters that support idempotency. SMTP remains
at-least-once because no SMTP protocol can prove whether a timed-out server
accepted a message; the SMTP adapter therefore uses bounded connection/socket
timeouts shorter than the default claim lease.

## Providers

`EmailProvider` is the only interface used by the worker. Automated tests use
`FakeEmailProvider`. `SmtpEmailProvider` is available but is never constructed
by application startup and fails closed through its environment factory when
explicit host, sender, and credentials are absent. No Production provider is
configured by this implementation.

## Future password reset integration

Password reset remains out of scope. The outbox schema reserves
`encrypted_payload` and the code defines `SensitiveEmailPayloadProtector`, but
there is deliberately no encryption key, encryption implementation, reset
route, or reset worker integration yet.

The password-reset task must:

1. Generate and hash the single-use token in the reset-token table.
2. Put only non-sensitive metadata in the ordinary JSON `payload`.
3. Seal the token-bearing reset URL using authenticated encryption and store
   only the ciphertext in `encrypted_payload`.
4. Decrypt only inside the delivery worker immediately before rendering.
5. Clear the ciphertext after success, terminal failure, cancellation, or
   expiration.
6. Reject delivery when the protector or key is unavailable.

Until that integration exists, `EmailOutboxService.enqueue` rejects
`password_reset` messages so a raw token-bearing URL cannot be persisted in the
ordinary JSON payload.