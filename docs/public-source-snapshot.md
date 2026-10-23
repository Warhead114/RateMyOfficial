# Public source snapshot

## Scope

The current Replit application was the authoritative source for this local
snapshot. The branch starts from the existing GitHub main, preserving that public
history while importing no private Replit ancestry. Synchronization does not
publish Replit, change Production, configure GitHub secrets or authorize email.

Application server/client/shared sources, the package/lock files, tests, all
seventeen migration paths, current email documentation, deployment/build
configuration and scoped email-runner sources are included. Required interface
backgrounds/silhouettes are retained unchanged. All scripts referenced by the
package configuration and Replit post-merge hook are included.

## Excluded categories

- Uploaded operational instructions, private audit notes and internal agent state.
- Personal/profile uploads and unreferenced historical diagnostic/maintenance
  utilities, including business-record-specific repair scripts.
- Historical change-log/workspace notes; the public README replaces their
  nonessential private operational context.
- Archives, multipart exports, database dumps, runtime binaries, dependency/build
  directories, secrets, fixture manifests and generated reports.

There is no runtime or build dependency on the excluded operational-upload folder.
Do not re-add entire upload/export directories to resolve a missing asset; retain
only separately reviewed static application assets.

## Intentional differences from the authoritative tree

1. `migrations/create_notifications_table.sql` is a no-op explanatory placeholder.
   The historical file performed account-specific profile maintenance, not schema
   creation. Private identities and that account-targeted UPDATE are not published.
   No other migration has been changed.
2. The private `.replit` is excluded; `replit.public.toml` preserves its setup
   as a template without the originating workspace's bucket identifier/personal
   workflow-author IDs. Validate/apply the template through supported Replit tools
   and provision storage privately if needed. No active workspace configuration
   was modified.
3. `.gitignore` and `.replitignore` add public-publication protections.
4. `.env.example`, this file and README provide value-free public setup guidance.
5. The external runner compares the committed source listing for server, shared,
   scripts/email-validation.ts and both package manifests with a pinned SHA-256:

   `7caf71d4b426f900e22e2a8213a83adc7be2f654444db4a1233135355c65bbc0`

   The listing is `git ls-tree -r --full-tree HEAD -- server shared
   scripts/email-validation.ts package.json package-lock.json`, trimmed before
   SHA-256. These source files remain byte-identical to the authoritative
   application. A source digest is used instead of requiring a private Replit
   commit object in a public clone. Exact approved HEAD and clean-worktree checks
   remain in place. Runner documentation reflects this ancestry-independent gate.

No dependency upgrades, application behavior changes, live activation, Production
data operations or weakening of the private-repository workflow guard are included.

## Review and publication

Only push this explicit snapshot branch after separate operator approval. Never
push all branches, mirror the Replit repository or force-push main. A reviewed
pull request into GitHub main is the intended remote operation; neither pushing
nor creating/merging that PR has been authorized by preparing this local branch.
