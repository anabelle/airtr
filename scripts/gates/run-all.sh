#!/bin/bash
# ============================================================
# Run All Gates
# Execute the full gate pipeline
# ============================================================

set -e

echo "═══════════════════════════════════════════════════════════"
echo "  ACARS Gate Pipeline"
echo "═══════════════════════════════════════════════════════════"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run each gate in sequence
"$SCRIPT_DIR/lint.sh"
echo ""

"$SCRIPT_DIR/typecheck.sh"
echo ""

"$SCRIPT_DIR/unit-test.sh"
echo ""

"$SCRIPT_DIR/contract-check.sh"
echo ""

"$SCRIPT_DIR/boundary-check.sh"
echo ""

"$SCRIPT_DIR/integration-test.sh"
echo ""

"$SCRIPT_DIR/build-check.sh"
echo ""

"$SCRIPT_DIR/determinism-check.sh"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  ✅ ALL GATES PASSED"
echo "═══════════════════════════════════════════════════════════"
