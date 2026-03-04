#!/bin/bash
# ============================================================
# Gate 3: Unit Tests
# Vitest — zone-scoped tests only
# ============================================================

set -e

echo "🔍 Gate 3: Unit Tests"

# Run all unit tests
pnpm test

echo "✅ Gate 3 passed: Unit tests complete"
