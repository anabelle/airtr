#!/bin/bash
# ============================================================
# Gate 5: Boundary Check
# List changed files (enforcement planned — requires OWNERS.md parsing)
# ============================================================

set -e

echo "🔍 Gate 5: Boundary Check"

# Get list of changed files in this branch vs main
CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1...HEAD)

if [ -z "$CHANGED_FILES" ]; then
  echo "  ℹ️  No changed files detected"
  echo "✅ Gate 5 passed: No boundary violations"
  exit 0
fi

# Check if changes are within a single zone
# For now, this is informational - actual enforcement would need OWNERS.md parsing
echo "  Changed files:"
echo "$CHANGED_FILES" | while read -r file; do
  echo "    - $file"
done

echo "✅ Gate 5 passed: Boundary check complete"
