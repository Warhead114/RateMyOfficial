# Public-repository runner hardening — execution held

This is a Development-only change, based on the sanitized public snapshot. It
does not change application code, schemas, fixtures, provider credentials, GitHub
settings or the existing snapshot PR. No real key was generated or installed.

## Two activation holds remain

1. The workflow still skips public repositories.
2. `PUBLIC_RUNNER_POLICY.enabled` is committed as `false`.

There is no environment-variable or workflow-input override. Tests exercise a
hypothetical later approved policy through dependency injection, never by changing
the shipped policy. Passing tests is not permission to activate or dispatch.
Future activation requires explicit operator approval, a narrowly reviewed change
to both holds, a final reviewed source/workflow SHA, and a separate approved run.

## Execution and disclosure boundary

- Manual dispatch only; hosted ephemeral runner; no reruns or automatic retries.
- Repository name, numeric repository/owner IDs, main branch and exact source and
  workflow revisions are checked. Forks/renames/transfers require new review.
- The runtime's read-only GitHub API checks verify the actual repository, run,
  environment rules, one main-only branch policy, disabled administrator bypass,
  self-review prevention, and a named independent reviewer's approved record for
  this exact run/environment. A readiness marker alone is insufficient.
- Only `contents: read` and `actions: read` are requested. No PAT, write permission,
  schedule, public endpoint, application startup, migration or unrestricted
  dispatcher is introduced. The Actions token is never forwarded to the CLI.
- Production values are passed only to the protected execution step, never to
  dependency installation/build. The existing environment approval gate still
  controls release of those secrets.
- Acknowledgements and the expected database host are protected environment
  secrets, not public workflow inputs/variables. Source SHA and key fingerprint
  are nonsecret. No recipient, plan or fixture identifier is a workflow output.
- Node tracing/coverage hooks and Actions debug modes are refused. The entire
  adapter process's stdout/stderr is redirected to a protected, non-artifact
  temporary file. Messages visible on failure are static.
- The CLI still validates exact recipients, fixture ownership, freshness, row and
  message hashes, duplicate-send state and cleanup scope. Its reviewed source
  digest is unchanged. The adapter retains the database advisory lock, cumulative
  ten-attempt reservations and refusal of ambiguous/interrupted reservations.
  Never reset the fixture UUID or journal to obtain another budget.
- The launcher suppresses its extra preflight JSON in machine mode. Multiple
  structured results are refused rather than mistaking preflight for a plan.
- Existing operator input files are never overwritten or deleted on an input
  collision. Business-record cleanup still goes exclusively through the unchanged
  exact, freshly authorized cleanup CLI.

## Encryption and artifact format

The only uploaded file is `email-validation-sealed/report.enc.json`. Its contents:
version, algorithm, public-key fingerprint, RSA-wrapped AES key, random nonce,
authentication tag and ciphertext. There are no plaintext operational fields.

Each report uses a fresh random 256-bit AES key and 96-bit nonce, AES-256-GCM
with a 128-bit tag, and RSA-OAEP/SHA-256 to wrap the key. Both algorithms bind the
constant `RateMyOfficial/email-validation-report/v1`. RSA SPKI public keys of
3072/4096/6144/8192 bits are supported. The SHA-256 fingerprint is calculated over
DER SPKI and checked before any GitHub/database/provider operation. A local
encryption probe also runs before external access. Key/plaintext buffers are
cleared where Node allows; JavaScript strings are not guaranteed erasable.

Reports include the fixture scope, operation, source SHA and GitHub run ID
**inside** encryption. They are serialized directly to memory, never to a plaintext
report file. Publication uses a protected temporary ciphertext file and an atomic
no-overwrite link. An independent envelope/file-mode/symlink gate must pass before
upload. Encryption, approval or artifact-gate failures never fall back to
plaintext. Failure reports contain only static recovery guidance, not raw errors.
Cleanup steps use `always()` to delete temporary inputs and private process logs.
An abruptly destroyed runner relies on GitHub-hosted ephemeral-machine teardown;
no private temporary path is ever included in artifact upload.

Native artifacts in a public repository are still publicly readable to repository
readers; encryption protects their content, not their ACL. Run timing, actors,
source revisions and the selected operation remain GitHub metadata. If even that
metadata must be private, use an adequately protected private execution repository
instead. Never treat retention or filesystem modes as public artifact privacy.

## Offline keys and decryption — instructions only, not executed

Use a trusted offline POSIX operator machine, not GitHub or Replit Development.
Keep the report private key on encrypted operator-controlled storage with mode
0600 and a mode-0700 parent. It is distinct from EMAIL_SENSITIVE_PAYLOAD_KEY.
Do not commit, paste, upload or configure the private key in any GitHub secret.

After separate key-setup approval, one possible offline procedure is:

```sh
umask 077
mkdir -m 700 /secure/operator-report-keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
  -out /secure/operator-report-keys/report-private.pem
openssl pkey -in /secure/operator-report-keys/report-private.pem -pubout \
  -out /secure/operator-report-keys/report-public.pem
openssl pkey -pubin -in /secure/operator-report-keys/report-public.pem \
  -outform DER | openssl dgst -sha256
```

Provision **only** the public PEM as protected environment secret
EMAIL_REPORT_PUBLIC_KEY and its independently verified fingerprint as environment
variable EMAIL_REPORT_KEY_SHA256. Storing even the public PEM as a secret prevents
accidental key material from being echoed in step environment summaries. The code
refuses private keys in that field. Do not reuse the Production payload key.
This task does not authorize changing these settings or generating a real key.

After a separately authorized SELECT-only preflight produces a report, download
the artifact from the exact approved GitHub run, extract its ciphertext, and on
the trusted offline machine run:

```sh
node scripts/email-report-decrypt.mjs /secure/download/report.enc.json \
  /secure/operator-report-keys/report-private.pem /secure/private-results/report.json
```

The output parent must already be mode 0700. The tool refuses GitHub/Replit
execution, permissive/symlinked key paths, and existing output files; it writes
mode-0600 plaintext only to the chosen file, never stdout. No network or key
generation is part of the tool. Do not attach decrypted files to GitHub or chat.
Verify source/run/fixture fields before using any plan. Encryption authenticates
ciphertext integrity, not its sender: only trust artifacts from the reviewed
GitHub job, not unsolicited encrypted files. Stop if decryption fails; never retry
a send to obtain another report.

## Remaining checks before any activation

- Independent review of this focused diff and its test results; no merge or push
  is authorized by preparation.
- Operator possession/recovery of the offline key, new public-key/fingerprint
  configuration, private acknowledgement, and expected-host secret placement.
- Approval of both activation holds and the final main-branch SHA, with no
  bypass of the existing environment protections.
- The first separately authorized live operation must be SELECT-only preflight.
  Actual Actions-token access, GitHub's run-review response and offline decryption
  have not been exercised with a real runner in Development. API denial/schema
  changes fail closed; no broader token is an automatic workaround.
- Existing dependency advisories and compromise of a trusted reviewer/runner or
  approved dependency are not solved by report encryption. No dependency changes
  or broad application audit are included.

The approved nine-message/ten-attempt business scope is unchanged. No worker,
scheduler, Production fixture, send or cleanup is executed by this change.

## Reproduce focused verification

From this branch's root, with dependencies already installed:

```sh
env -i PATH="$PATH" HOME="$HOME" node --test \
  tests/email-production-runner.test.mjs tests/email-github-runner.test.mjs \
  tests/email-public-runner.test.mjs
env -i PATH="$PATH" HOME="$HOME" node --import tsx --test tests/email-validation.test.ts
```

These tests use synthetic keys/recipients, injected database/provider substitutes
and mocked GitHub responses. They do not dispatch the workflow or contact
Production. Do not substitute a broad database integration-test command.
