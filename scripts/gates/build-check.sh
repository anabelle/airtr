#!/bin/bash
# ============================================================
# Gate 7: Build Check
# Full production build
# ============================================================

set -e

echo "🔍 Gate 7: Build Check"

# Run production build
pnpm build

echo "✅ Gate 7 passed: Build check complete"
