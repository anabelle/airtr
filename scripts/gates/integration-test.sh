#!/bin/bash
# ============================================================
# Gate 6: Integration Tests
# Cross-zone tests
# ============================================================

set -e

echo "🔍 Gate 6: Integration Tests"

# Check if test:integration script exists in package.json
if grep -q '"test:integration"' package.json; then
  pnpm test:integration
  echo "✅ Gate 6 passed: Integration tests complete"
else
  echo "  ℹ️  No integration tests configured (skipping)"
  echo "✅ Gate 6 passed: Integration tests skipped"
fi
