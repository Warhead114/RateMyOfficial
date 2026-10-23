# RateMyOfficial

Full-stack application for official profiles, event assignments, evaluations,
coach/regional administration and transactional email.

## Local development

Use Node.js 22 and npm. Install locked dependencies with `npm ci`. Configure a
dedicated Development PostgreSQL database and environment through your trusted
runtime; `.env.example` lists required/optional variable names without values.
The application reads process environment variables, not this template file.
Never copy Production database connections or Production secrets into Development.
`replit.public.toml` is a sanitized Replit configuration template, not an active
workspace configuration. Validate/apply it through Replit's supported tools;
private originating-workspace identifiers are not part of the public source.

- `npm run dev` starts the Development application.
- `npm run check` checks TypeScript.
- `npm run build` produces the web/server and scoped validation CLI bundles.
- `npm test` runs automated tests; database integration commands require a
  separately proven, isolated Development test database.

Do not run tests, diagnostics or SQL against Production as a setup shortcut.
SQL under `migrations/` is source documentation/prepared changes, not permission
to apply it. Follow the target environment's authorized migration procedure.

## Public snapshot boundary

This branch is a sanitized current-source snapshot based on the existing GitHub
main history. It does not import private Replit commit ancestry. See
[snapshot notes](docs/public-source-snapshot.md) for exclusions and intentional
differences. Runtime user data and personal photos are not bundled; only reviewed
interface/background assets are included.

## Email safety

Delivery defaults to off. The manual GitHub validation workflow is included as
source but intentionally rejects public repositories and remains unsuitable for
execution in this public destination until the separately approved
[hardening and activation procedure](docs/email-public-runner-hardening.md) is complete.
Do not enable secrets, change that guard or trigger jobs as part of synchronization.

See [the protected runner procedure](docs/email-github-actions.md) and
[scoped validation contracts](docs/email-scoped-validation.md). Live delivery,
workers, scheduling, Production fixtures and cleanup all require their appropriate
separate authorizations. Publishing this source is not email-execution approval.
