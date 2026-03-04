#!/bin/bash
# ============================================================
# Gate 4: Contract Check
# Verify exports match CONTRACT.md
# ============================================================

set -e

echo "🔍 Gate 4: Contract Check"

PACKAGES=("packages/core" "packages/data" "packages/nostr" "packages/store" "packages/map")

for pkg in "${PACKAGES[@]}"; do
  CONTRACT_FILE="$pkg/CONTRACT.md"
  
  if [ ! -f "$CONTRACT_FILE" ]; then
    echo "❌ Missing CONTRACT.md in $pkg"
    exit 1
  fi
  
  echo "  ✓ Found CONTRACT.md in $pkg"
done

echo "✅ Gate 4 passed: All packages have CONTRACT.md files"
