#!/bin/bash
# ============================================================
# Gate 2: Type Check
# tsc --noEmit (full type check)
# ============================================================

set -e

echo "🔍 Gate 2: Type Check"

# Run TypeScript type checking on all packages
pnpm typecheck

echo "✅ Gate 2 passed: Type check complete"
