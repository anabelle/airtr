#!/bin/bash
# ============================================================
# Gate 1: Lint Check
# ESLint, Prettier, TypeScript strict mode
# ============================================================

set -e

echo "🔍 Gate 1: Lint Check"

# Run ESLint on all packages
pnpm lint

echo "✅ Gate 1 passed: Lint check complete"
