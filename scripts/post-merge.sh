#!/usr/bin/env bash
set -euo pipefail

# Reconcile JavaScript dependencies after isolated task branches merge.
# npm install is idempotent and preserves the existing lockfile contract.
npm install --no-audit --no-fund

# Catch merged source or dependency changes that cannot produce a runnable app.
npm run build