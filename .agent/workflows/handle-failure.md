---
description: How an agent handles a gate failure and retries
---

# Handle Gate Failure

When a CI gate fails on your submitted branch, follow this procedure.

## Step 1: Read the Failure Report
// turbo
1. Read `.agent/feedback/TASK-NNN/gate-failure-{N}.md`
2. Identify which gate failed (lint, typecheck, unit-test, contract, boundary, etc.)
3. Read the specific error messages carefully

## Step 2: Diagnose

### If LINT failed:
- Run `pnpm lint --filter=@airtr/{zone}` locally
- Fix formatting and style issues
- Common causes: trailing whitespace, missing semicolons, unused imports

### If TYPECHECK failed:
- Run `pnpm typecheck --filter=@airtr/{zone}` locally
- Fix type errors
- Common causes: wrong type, missing import, interface mismatch
- CHECK: Are you using types from another zone? Read their CONTRACT.md.

### If UNIT TEST failed:
- Run `pnpm test --filter=@airtr/{zone} --run` locally
- Read test output to identify failing test
- Common causes: wrong expected value, missing edge case, async issue

### If CONTRACT CHECK failed:
- Your exports don't match what CONTRACT.md declares
- Read CONTRACT.md carefully
- Ensure all contracted functions/types are exported with EXACT signatures
- You may NOT modify CONTRACT.md — only a contract evolution proposal can do that

### If BOUNDARY CHECK failed:
- **CRITICAL**: You modified files OUTSIDE your owned zone
- Revert ALL changes to files outside your zone
- If you need to change another zone, create a PROPOSAL or a dependent task

### If INTEGRATION TEST failed:
- Your changes broke something in how zones interact
- Read the integration test output
- Common causes: contract mismatch, import error, type incompatibility

### If DETERMINISM CHECK failed (core zone only):
- Your changes made the simulation non-deterministic
- Check for: floating-point math, `Math.random()`, `Date.now()`, 
  `Object.keys()` iteration order, `Set` iteration order
- All financial math must use fixed-point integers
- All randomness must use the seeded PRNG from `prng.ts`

## Step 3: Fix and Re-submit
1. Make the necessary fixes
2. Run self-verification again (lint, typecheck, test)
// turbo
3. Commit: `git add -A && git commit -m "fix(TASK-NNN): address gate failure {N}"`
4. Push: `git push origin agent/TASK-NNN`
5. CI gates will re-run automatically

## Step 4: If You've Failed 3 Times
1. Move task to failed: `mv .agent/tasks/review/TASK-NNN.md .agent/tasks/failed/TASK-NNN.md`
2. Update status: `Status: failed`
3. Reset the zone's OWNERS.md to "available"
4. **STOP** — do not attempt further fixes
5. A human will review the failure and either:
   - Provide guidance and return the task to backlog
   - Restructure the task into smaller subtasks
   - Fix the issue themselves
