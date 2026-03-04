#!/bin/bash
# ============================================================
# Gate 8: Determinism Check
# For @acars/core only: replay 100 ticks, verify hash
# ============================================================

set -e

echo "🔍 Gate 8: Determinism Check"

# Run determinism tests in @acars/core
if [ -f "packages/core/src/determinism.test.ts" ]; then
  pnpm test --filter=@acars/core determinism
  echo "✅ Gate 8 passed: Determinism verified"
else
  echo "  ℹ️  No determinism test file found"
  echo "  Running all @acars/core tests instead..."
  pnpm test --filter=@acars/core
  echo "✅ Gate 8 passed: Core tests complete"
fi
