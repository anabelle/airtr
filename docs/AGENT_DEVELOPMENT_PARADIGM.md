# ACARS — Agent-Collaborative Development Paradigm (ACDP)

## A Safe, Scalable, and Fail-Safe System for AI Agents to Build Software Together

---

## The Problem

Multiple AI agents working on the same codebase will:

- **Stomp on each other's files** if working concurrently without coordination
- **Break contracts** between packages if they don't understand boundaries
- **Introduce regressions** if there's no automated verification
- **Diverge in style/approach** without shared standards
- **Cascade failures** — one agent's mistake poisons another agent's context
- **Lose context** across conversations, leading to contradictory decisions

We need a paradigm that makes **agent collaboration as safe as git makes human collaboration** — but adapted for how agents actually work (no meetings, no Slack, pure async, context-limited).

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [The Ownership Model](#2-the-ownership-model)
3. [The Contract System](#3-the-contract-system)
4. [The Gate System](#4-the-gate-system)
5. [The Task Protocol](#5-the-task-protocol)
6. [The Verification Pipeline](#6-the-verification-pipeline)
7. [Fail-Safe Mechanisms](#7-fail-safe-mechanisms)
8. [Knowledge Persistence](#8-knowledge-persistence)
9. [Scaling Model](#9-scaling-model)
10. [Implementation](#10-implementation)

---

## 1. Core Principles

### 1.1 The Five Laws of Agent Development

```
LAW 1: BOUNDED OWNERSHIP
  Every file, directory, and module has exactly ONE owner at any time.
  An agent may only modify files within its owned boundary.
  Ownership is explicit, tracked, and transferable.

LAW 2: CONTRACT-FIRST
  All cross-boundary communication is through typed interfaces.
  Interfaces are defined BEFORE implementation.
  An agent can NEVER break a published contract.
  Contracts can only be evolved through a formal deprecation process.

LAW 3: VERIFY-BEFORE-MERGE
  No agent output reaches the trunk without passing ALL gates.
  Gates are automated, deterministic, and fast.
  A failing gate is an absolute veto — no exceptions, no overrides by agents.

LAW 4: FAIL-SAFE DEFAULTS
  If an agent crashes, times out, or produces invalid output,
  the system reverts to the last known-good state.
  No partial work is ever committed to trunk.
  Every operation is atomic — it either fully succeeds or fully rolls back.

LAW 5: KNOWLEDGE FLOWS DOWN, NEVER SIDEWAYS
  Agents don't communicate with each other directly.
  All coordination flows through shared artifacts:
  contracts, docs, task queue, and the codebase itself.
  This prevents the "telephone game" failure mode.
```

### 1.2 Why These Laws Exist

| Law                  | Without It                                                                   | With It                                       |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Bounded Ownership    | Two agents edit the same file → merge conflict → corruption                  | Clean parallel work, zero conflicts           |
| Contract-First       | Agent A changes a function signature → Agent B's code breaks                 | Both agents code against stable interfaces    |
| Verify-Before-Merge  | Bad code reaches trunk → poisons every other agent's context                 | Trunk is always green, always correct         |
| Fail-Safe Defaults   | Agent crashes mid-edit → half-written file → cascading breakage              | Atomic rollback, system self-heals            |
| Knowledge Flows Down | Agent A tells Agent B "I changed the API" but gets it wrong → silent failure | Single source of truth (the code + contracts) |

---

## 2. The Ownership Model

### 2.1 Bounded Contexts as Ownership Zones

Each package in the monorepo is a **bounded context** with a single owner:

```
acars/
├── packages/
│   ├── @acars/core          ← ZONE: "core"
│   │   ├── OWNERS.md        ← Declares who can modify this zone
│   │   ├── CONTRACT.md      ← Public API contract
│   │   └── ...
│   │
│   ├── @acars/data          ← ZONE: "data"
│   ├── @acars/nostr         ← ZONE: "nostr"
│   ├── @acars/map           ← ZONE: "map"
│   └── @acars/store         ← ZONE: "store"
│
├── apps/
│   └── web/                 ← ZONE: "app"
│
└── docs/                    ← ZONE: "docs"
```

> **Note**: The Design Bible describes additional planned packages (`@acars/ui`, `@acars/3d`, `@acars/audio`, `@acars/i18n`) that have not yet been created. When they are implemented, they will become additional ownership zones.

### 2.2 OWNERS.md Format

Each zone has an `OWNERS.md` file at its root:

```markdown
# @acars/core — Ownership Record

## Current Owner

- **Agent**: agent-core-v1
- **Since**: 2026-02-20T20:30:00Z
- **Task**: TASK-007 (Implement gravity demand model)

## Ownership Rules

- Only the listed agent may create, modify, or delete files in this zone.
- Ownership is acquired by claiming a task that targets this zone.
- Ownership is released when the task is completed and merged.
- The human operator can override ownership at any time.

## Read-Only Access

All agents may READ files in this zone at any time.
Reading never requires ownership.

## Dependencies (zones this zone imports from)

- @acars/data (read-only: airport data types)

## Dependents (zones that import from this zone)

- @acars/store
- @acars/nostr
```

### 2.3 Ownership Lifecycle

```
AVAILABLE → CLAIMED → ACTIVE → REVIEW → MERGED → AVAILABLE
    │           │        │         │         │
    │           │        │         │         └─ Zone is released
    │           │        │         └─ Gates running, agent waits
    │           │        └─ Agent is actively modifying files
    │           └─ Agent has lock, sets up branch
    └─ No agent owns this zone
```

**Key constraint**: An agent can own **at most 2 zones simultaneously** (to prevent one agent from monopolizing the codebase). For cross-zone work, use the Task Protocol (Section 5).

---

## 3. The Contract System

### 3.1 Why Contracts Are the Backbone

In multi-agent development, **contracts replace communication**. Instead of agents "talking" to each other about interfaces, they read and write formal contracts. This eliminates misunderstanding, ambiguity, and the telephone game.

### 3.2 CONTRACT.md Format

Every zone publishes a `CONTRACT.md` that specifies its public API:

````markdown
# @acars/core — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Exported Types

```typescript
// Airport
interface Airport {
  id: string; // OpenFlights ID
  name: string; // Airport name (English)
  iata: string; // 3-letter IATA code
  icao: string; // 4-letter ICAO code
  latitude: number; // Decimal degrees
  longitude: number; // Decimal degrees
  altitude: number; // Feet above sea level
  timezone: string; // IANA timezone
  country: string; // ISO 3166-1 alpha-2
}

// DemandResult
interface DemandResult {
  origin: string; // IATA code
  destination: string; // IATA code
  economy: number; // Weekly pax demand
  business: number; // Weekly pax demand
  first: number; // Weekly pax demand
}
```
````

### Exported Functions

```typescript
// Calculate demand between two airports
function calculateDemand(
  origin: Airport,
  destination: Airport,
  season: Season,
  prosperityIndex: number,
): DemandResult;

// Calculate QSI for a flight
function calculateQSI(
  flight: FlightOffer,
  competitors: FlightOffer[],
  passengerClass: "economy" | "business" | "first",
): number;
```

### Contract Rules

1. All exports listed above are FROZEN until a major version bump.
2. New exports may be ADDED without a version bump.
3. Existing exports may NOT be modified or removed without:
   a. A deprecation notice in this file
   b. A migration guide
   c. A major version bump (1.x → 2.0)
   d. Human operator approval

````

### 3.3 Contract Verification (Automated)

A CI check verifies that every zone's actual exports match its `CONTRACT.md`:

```bash
# scripts/verify-contracts.sh
# For each zone, extract actual TypeScript exports and diff against CONTRACT.md
# FAIL if any contracted export is missing or has a different signature
# WARN if there are exports not listed in the contract (undocumented API)
````

This means: **An agent physically cannot break a contract.** The gate catches it before merge.

### 3.4 Contract Evolution Protocol

When an agent needs to change a contract:

```
1. Agent creates a PROPOSAL file:
   packages/@acars/core/PROPOSALS/002-add-cargo-demand.md

2. Proposal includes:
   - What changes
   - Why it's needed
   - Migration path for dependents
   - Backward compatibility analysis

3. Human operator reviews and approves/rejects
   (This is the ONE human-in-the-loop moment)

4. If approved:
   - CONTRACT.md is updated
   - Dependent zones are notified via task queue
   - A migration task is auto-created for each dependent
```

---

## 4. The Gate System

### 4.1 Gate Architecture

Every agent's work must pass through a sequence of **gates** before reaching trunk. Gates are automated, deterministic, and non-bypassable.

```
Agent completes work on branch
        │
        ▼
┌─────────────────┐
│  GATE 1: LINT   │  ESLint, Prettier, TypeScript strict mode
│  (< 10 seconds) │  "Does it follow the rules?"
└────────┬────────┘
         │ PASS
         ▼
┌─────────────────┐
│  GATE 2: TYPE   │  tsc --noEmit (full type check)
│  (< 30 seconds) │  "Does it compile?"
└────────┬────────┘
         │ PASS
         ▼
┌─────────────────────┐
│  GATE 3: UNIT TEST  │  Vitest — zone-scoped tests only
│  (< 60 seconds)     │  "Does it work in isolation?"
└────────┬────────────┘
         │ PASS
         ▼
┌──────────────────────────┐
│  GATE 4: CONTRACT CHECK  │  Verify exports match CONTRACT.md
│  (< 10 seconds)          │  "Does it honor its promises?"
└────────┬─────────────────┘
         │ PASS
         ▼
┌──────────────────────────┐
│  GATE 5: BOUNDARY CHECK  │  Verify agent only modified owned zone
│  (< 5 seconds)           │  "Did it stay in its lane?"
└────────┬─────────────────┘
         │ PASS
         ▼
┌──────────────────────────────┐
│  GATE 6: INTEGRATION TEST   │  Cross-zone tests
│  (< 120 seconds)            │  "Does it work with everything else?"
└────────┬─────────────────────┘
         │ PASS
         ▼
┌──────────────────────────────┐
│  GATE 7: BUILD CHECK        │  Full production build
│  (< 120 seconds)            │  "Can it ship?"
└────────┬─────────────────────┘
         │ PASS
         ▼
┌──────────────────────────────┐
│  GATE 8: DETERMINISM CHECK  │  For @acars/core only:
│  (< 60 seconds)             │  replay 100 ticks, verify hash
│                              │  "Is the simulation still pure?"
└────────┬─────────────────────┘
         │ ALL PASS
         ▼
    ✅ AUTO-MERGE TO TRUNK
```

### 4.2 Gate Failure Behavior

```
If ANY gate fails:
  1. Branch is NOT merged
  2. Failure details are written to:
     .agent/feedback/{task-id}/gate-failure.md
  3. Agent reads feedback file on next invocation
  4. Agent has 3 retry attempts
  5. After 3 failures: task is SUSPENDED, human notified
  6. Trunk is NEVER compromised
```

### 4.3 The "Green Trunk" Guarantee

```
INVARIANT: The trunk (main branch) is ALWAYS in a state where:
  ✅ All code compiles with zero TypeScript errors
  ✅ All tests pass
  ✅ All contracts are satisfied
  ✅ The app builds successfully
  ✅ The simulation is deterministic

This is NON-NEGOTIABLE. Any agent can clone trunk at any time
and have a perfectly working codebase.
```

---

## 5. The Task Protocol

### 5.1 How Work Gets Assigned

Work flows through a **task queue** — a set of markdown files that define what needs to be built:

```
.agent/
├── tasks/
│   ├── backlog/              ← Available tasks, not yet claimed
│   │   ├── TASK-010.md
│   │   ├── TASK-011.md
│   │   └── TASK-012.md
│   │
│   ├── active/               ← Currently being worked on
│   │   ├── TASK-007.md       ← Claimed by agent-core-v1
│   │   └── TASK-009.md       ← Claimed by agent-ui-v1
│   │
│   ├── review/               ← Completed, awaiting gate verification
│   │   └── TASK-006.md
│   │
│   ├── done/                 ← Merged to trunk
│   │   ├── TASK-001.md
│   │   ├── TASK-002.md
│   │   └── ...
│   │
│   └── failed/               ← Failed 3 gate attempts, needs human
│       └── TASK-005.md
│
├── feedback/                  ← Gate failure reports, review notes
│   ├── TASK-005/
│   │   ├── gate-failure-1.md
│   │   ├── gate-failure-2.md
│   │   └── gate-failure-3.md
│   └── TASK-007/
│       └── gate-failure-1.md
│
├── contracts/                 ← Symlinks to all CONTRACT.md files
│   ├── core.md → ../../packages/@acars/core/CONTRACT.md
│   ├── store.md → ../../packages/@acars/store/CONTRACT.md
│   └── ...
│
└── config/
    ├── agents.yaml            ← Agent registry and capabilities
    ├── zones.yaml             ← Zone ownership map
    └── gates.yaml             ← Gate configuration
```

### 5.2 Task File Format

```markdown
# TASK-010: Implement Gravity Demand Model

## Metadata

- **ID**: TASK-010
- **Status**: backlog | active | review | done | failed
- **Priority**: P1 (critical) | P2 (important) | P3 (nice-to-have)
- **Zone**: @acars/core
- **Estimated Complexity**: 3/5
- **Claimed By**: (empty until claimed)
- **Branch**: (auto-created on claim)
- **Created**: 2026-02-20T20:30:00Z
- **Dependencies**: TASK-008 (must be DONE first)

## Objective

Implement the gravity model formula for calculating passenger demand
between any two airports.

## Requirements

1. Implement `calculateDemand()` function matching the CONTRACT.md spec
2. Use fixed-point arithmetic (no IEEE 754 floats for financial math)
3. Support seasonal modulation (summer/winter multipliers)
4. Support prosperity index modulation
5. Unit tests with known input/output pairs
6. Must be deterministic: same inputs → same outputs always

## Acceptance Criteria

- [ ] `calculateDemand()` exported and matches contract signature
- [ ] 20+ unit tests covering edge cases (zero population, antipodal routes, etc.)
- [ ] All gates pass
- [ ] Results match hand-calculated expected values (provided below)

## Test Vectors

| Origin | Destination | Season | Prosperity | Expected Econ | Expected Biz |
| ------ | ----------- | ------ | ---------- | ------------- | ------------ |
| JFK    | LAX         | summer | 1.0        | 48,500        | 12,100       |
| JFK    | LHR         | winter | 1.0        | 31,200        | 9,800        |
| GKA    | POM         | summer | 0.8        | 340           | 42           |

## Context Files (read these first)

- docs/DESIGN_PRINCIPLES.md — Section 2 (Engagement Architecture)
- packages/@acars/core/CONTRACT.md
- packages/data/src/airports.ts (schema reference)

## Constraints

- Do NOT modify any files outside packages/@acars/core/
- Do NOT add new external dependencies
- Do NOT change any existing exported interfaces
```

### 5.3 Task Lifecycle

```
HUMAN creates task → backlog/TASK-NNN.md
         │
         ▼
AGENT claims task → moves to active/TASK-NNN.md
  - Sets "Claimed By" field
  - Creates branch: agent/TASK-NNN
  - Acquires zone ownership
         │
         ▼
AGENT works on branch
  - Reads contract files
  - Reads context files
  - Implements requirements
  - Writes tests
  - Self-validates (runs gates locally)
         │
         ▼
AGENT submits for review → moves to review/TASK-NNN.md
  - Pushes branch
  - CI gates run automatically
         │
         ├─── GATES PASS → moves to done/TASK-NNN.md
         │     - Auto-merge to trunk
         │     - Release zone ownership
         │
         └─── GATES FAIL → feedback written
               - Agent reads feedback
               - Agent fixes and resubmits
               - After 3 failures → moves to failed/TASK-NNN.md
               - Human intervenes
```

---

## 6. The Verification Pipeline

### 6.1 Five Levels of Verification

```
Level 1: SELF-VERIFICATION (Agent runs before submitting)
  The agent runs linting, type-check, and tests locally before
  pushing. This catches ~80% of issues immediately.

Level 2: AUTOMATED GATES (CI runs on push)
  Full gate pipeline as described in Section 4.
  Catches type errors, test failures, contract violations,
  boundary violations.

Level 3: DETERMINISM VERIFICATION (For @acars/core only)
  Replays a known sequence of 100 game ticks and compares
  the final state hash against a stored expected hash.
  If the hash differs, the simulation is no longer deterministic.
  This catches floating-point regressions, non-deterministic
  iteration order, etc.

Level 4: SMOKE TEST (Integration)
  After merge to trunk, a smoke test runs the full app:
  - Boots the dev server
  - Loads the map
  - Creates an airline
  - Opens a route
  - Verifies no console errors
  If this fails, trunk is auto-reverted to previous commit.

Level 5: HUMAN REVIEW (Periodic)
  The human operator periodically reviews:
  - Done tasks and their quality
  - Failed tasks and their failure patterns
  - Architecture drift (are agents making odd decisions?)
  - Contract evolution proposals
  This is NOT a bottleneck — it happens async, after merge.
```

### 6.2 The Snapshot System

After every successful merge, the system takes a **snapshot**:

```typescript
interface TrunkSnapshot {
  commitHash: string;
  timestamp: string;
  taskId: string;
  gateResults: GateResult[]; // All 8 gates and their pass/fail + timing
  buildArtifact: string; // Path to built app
  stateHash: string; // Determinism verification hash (if applicable)
  testCoverage: number; // Overall test coverage percentage
}
```

Snapshots enable:

- **Instant rollback** to any known-good state
- **Bisection** — find exactly which task introduced a bug
- **Progress tracking** — visualize project velocity over time

---

## 7. Fail-Safe Mechanisms

### 7.1 Failure Taxonomy

```
┌────────────────────────────────┬────────────────────────────────┐
│ FAILURE TYPE                   │ AUTOMATIC RESPONSE             │
├────────────────────────────────┼────────────────────────────────┤
│ Agent timeout (no output in    │ Release zone ownership.        │
│ 30 min)                        │ Move task back to backlog.     │
│                                │ Another agent can claim it.    │
├────────────────────────────────┼────────────────────────────────┤
│ Gate failure (test/type/lint)  │ Write feedback to agent dir.   │
│                                │ Agent retries (max 3x).        │
│                                │ After 3x → suspend, notify.   │
├────────────────────────────────┼────────────────────────────────┤
│ Boundary violation (agent      │ HARD REJECT. Branch deleted.   │
│ edited files outside its zone) │ Task returned to backlog.      │
│                                │ Incident logged.               │
├────────────────────────────────┼────────────────────────────────┤
│ Contract violation (agent      │ HARD REJECT. Branch deleted.   │
│ broke a published interface)   │ Task returned to backlog.      │
│                                │ Incident logged.               │
├────────────────────────────────┼────────────────────────────────┤
│ Post-merge smoke test failure  │ AUTO-REVERT trunk to previous  │
│                                │ snapshot. Task moved to failed.│
│                                │ Human notified immediately.    │
├────────────────────────────────┼────────────────────────────────┤
│ Agent produces empty/garbage   │ Detected by "sanity gate":     │
│ output                         │ min 10 LOC changed, must       │
│                                │ include tests. Rejected.       │
├────────────────────────────────┼────────────────────────────────┤
│ Two agents claim same zone     │ FIFO: first claim wins.        │
│                                │ Second agent gets rejection    │
│                                │ with explanation.              │
├────────────────────────────────┼────────────────────────────────┤
│ Circular dependency detected   │ Gate 6 (integration) catches.  │
│ between zones                  │ HARD REJECT with explanation.  │
└────────────────────────────────┴────────────────────────────────┘
```

### 7.2 The "Dead Man's Switch"

If no agent activity occurs for 24 hours:

1. All zone ownerships are automatically released
2. All active tasks are moved back to backlog
3. A status report is generated for the human operator

This prevents "zombie locks" where a crashed agent holds a zone forever.

### 7.3 The "Blast Radius" Limiter

Each task has a **maximum diff size**:

- Default: 500 lines changed
- Large tasks: 1000 lines (requires `size: large` in task metadata)
- XL tasks: 2000 lines (requires human pre-approval)

If an agent exceeds the diff limit, the submission is **rejected** with a suggestion to break the task into smaller subtasks.

**Why**: Small diffs are easier to verify, easier to revert, and less likely to contain hidden bugs. This is the single most effective quality control mechanism.

---

## 8. Knowledge Persistence

### 8.1 The Problem of Agent Amnesia

Each agent conversation is ephemeral — when a new session starts, the agent has lost context from previous sessions. This is the **#1 failure mode** in multi-agent development.

### 8.2 The Knowledge Artifact System

Every piece of knowledge is persisted as a file in the repo:

```
.agent/
├── knowledge/
│   ├── decisions/             ← Architecture Decision Records
│   │   ├── ADR-001-use-cesiumjs-for-3d.md
│   │   ├── ADR-002-fixed-point-math.md
│   │   ├── ADR-003-zustand-for-state.md
│   │   └── ADR-004-gravity-model-params.md
│   │
│   ├── patterns/              ← Established code patterns
│   │   ├── PATTERN-error-handling.md
│   │   ├── PATTERN-zustand-store.md
│   │   ├── PATTERN-nostr-event.md
│   │   └── PATTERN-react-component.md
│   │
│   ├── glossary.md            ← Domain terminology definitions
│   │
│   └── lessons/               ← Post-mortems from failed tasks
│       ├── LESSON-001-float-precision.md
│       └── LESSON-002-import-cycle.md
│
├── templates/                  ← File templates agents should use
│   ├── zustand-store.template.ts
│   ├── react-component.template.tsx
│   ├── unit-test.template.ts
│   └── nostr-event.template.ts
```

### 8.3 ADR (Architecture Decision Record) Format

```markdown
# ADR-002: Use Fixed-Point Arithmetic for Economic Calculations

## Status: ACCEPTED

## Date: 2026-02-20

## Context

The game simulation must be deterministic across all clients.
IEEE 754 floating-point arithmetic produces different results on
different hardware, compilers, and optimization levels.

## Decision

All financial and economic calculations in @acars/core will use
fixed-point arithmetic with 4 decimal places of precision.
We will use integer math internally, dividing by 10000 only for display.

Example: $123.45 is stored as 1234500 (integer cents × 100 = 4 decimal fixed)

## Consequences

- ✅ Perfect determinism across all platforms
- ✅ No rounding surprises
- ⚠️ Slightly more complex arithmetic code
- ⚠️ Must be careful about overflow with large numbers
- 🚫 No agent may use `number` for financial values in @acars/core
```

### 8.4 The Context Window — What Every Agent Reads First

When any agent starts a task, it MUST read (in this order):

```
1. .agent/tasks/active/TASK-NNN.md          ← What to do
2. The zone's CONTRACT.md                    ← What the API must look like
3. The zone's OWNERS.md                      ← What dependencies exist
4. .agent/knowledge/decisions/*.md           ← Why things are the way they are
5. .agent/knowledge/patterns/*.md            ← How to write code in this project
6. .agent/feedback/TASK-NNN/*.md             ← Previous failure feedback (if retry)
7. docs/DESIGN_PRINCIPLES.md (relevant sections)  ← Game design context
```

This ordered reading list ensures every agent starts with the same context, regardless of which AI model or platform is running it.

---

## 9. Scaling Model

### 9.1 Parallelism Strategy

The system supports **N agents working simultaneously**, limited only by zone availability:

```
Scenario: 4 agents available, 6 zones

Agent-A claims @acars/core         → works on TASK-010
Agent-B claims apps/web            → works on TASK-011
Agent-C claims @acars/map          → works on TASK-012
Agent-D claims @acars/nostr        → works on TASK-013

All 4 agents work IN PARALLEL on separate zones.
No conflicts possible — they literally cannot touch each other's files.

When Agent-A finishes and releases @acars/core:
Agent-D (finished with nostr) can claim @acars/core for TASK-014.
```

### 9.2 Dependency-Aware Scheduling

Tasks have dependencies. The scheduler respects them:

```yaml
# .agent/config/task-graph.yaml
TASK-010: # Gravity demand model
  zone: core
  depends: []

TASK-011: # Flight info panel UI
  zone: ui
  depends: [TASK-010] # Needs demand types from core

TASK-012: # Aircraft layer on map
  zone: map
  depends: []

TASK-013: # Cabin chime sounds
  zone: audio
  depends: []

TASK-014: # Zustand store for airline state
  zone: store
  depends: [TASK-010] # Needs types from core
```

Agents can only claim tasks whose dependencies are ALL in `done` status.

### 9.3 Throughput Model

```
Assuming:
- Average task: 2 hours of agent work
- Average gate pipeline: 5 minutes
- 4 parallel agents
- 8 tasks per day per agent (with failures/retries)

Daily throughput: 32 tasks/day
Weekly throughput: ~160 tasks/week

At this rate, the MVP (estimated ~200 tasks) ships in 1.5 weeks
of continuous agent operation.
```

### 9.4 Agent Registry

```yaml
# .agent/config/agents.yaml
agents:
  - id: agent-core
    name: "Core Engine Agent"
    capabilities: [typescript, math, algorithms, testing]
    preferred_zones: [core, data]
    max_concurrent_tasks: 1

  - id: agent-ui
    name: "UI & Frontend Agent"
    capabilities: [react, css, accessibility, routing]
    preferred_zones: [app]
    max_concurrent_tasks: 1

  - id: agent-map
    name: "Map & Visualization Agent"
    capabilities: [webgl, maplibre, geospatial]
    preferred_zones: [map]
    max_concurrent_tasks: 1

  - id: agent-infra
    name: "Infrastructure Agent"
    capabilities: [nostr, networking, build-tools, ci-cd]
    preferred_zones: [nostr, store]
    max_concurrent_tasks: 1
```

---

## 10. Implementation

### 10.1 File Structure (The Minimum Viable ACDP)

```
acars/
├── .agent/                         ← THE COMMAND CENTER
│   ├── config/
│   │   ├── agents.yaml             ← Agent registry
│   │   ├── zones.yaml              ← Zone → directory mapping
│   │   └── gates.yaml              ← Gate configuration
│   │
│   ├── tasks/
│   │   ├── backlog/                ← Available work
│   │   ├── active/                 ← In progress
│   │   ├── review/                 ← Awaiting gates
│   │   ├── done/                   ← Complete
│   │   └── failed/                 ← Needs human help
│   │
│   ├── feedback/                   ← Gate failure reports
│   │
│   ├── knowledge/
│   │   ├── decisions/              ← ADRs
│   │   ├── patterns/               ← Code patterns
│   │   ├── lessons/                ← Post-mortems
│   │   └── glossary.md             ← Terms
│   │
│   ├── templates/                  ← Code templates
│   │
│   └── workflows/                  ← Agent instruction files
│       ├── claim-task.md           ← How to claim a task
│       ├── submit-work.md          ← How to submit work
│       ├── handle-failure.md       ← How to handle gate failures
│       └── evolve-contract.md      ← How to propose contract changes
│
├── scripts/
│   ├── gates/
│   │   ├── lint.sh                 ← Gate 1
│   │   ├── typecheck.sh            ← Gate 2
│   │   ├── unit-test.sh            ← Gate 3
│   │   ├── contract-check.sh       ← Gate 4
│   │   ├── boundary-check.sh       ← Gate 5
│   │   ├── integration-test.sh     ← Gate 6
│   │   ├── build-check.sh          ← Gate 7
│   │   └── determinism-check.sh    ← Gate 8
│   │
│   ├── claim-task.sh               ← Atomic task claiming
│   ├── release-zone.sh             ← Release zone ownership
│   ├── snapshot.sh                 ← Take trunk snapshot
│   └── dead-mans-switch.sh         ← Check for zombie locks
│
├── packages/                       ← THE CODE
│   ├── @acars/core/
│   │   ├── CONTRACT.md
│   │   ├── OWNERS.md
│   │   ├── src/
│   │   └── tests/
│   └── ... (other zones)
│
└── .github/
    └── workflows/
        ├── gates.yml               ← CI pipeline for all gates
        ├── smoke-test.yml          ← Post-merge smoke test
        └── dead-mans-switch.yml    ← Cron job for zombie lock check
```

### 10.2 The Agent Workflow (Step by Step)

```markdown
# .agent/workflows/claim-task.md

---

## description: How an agent claims and executes a task

## Step 1: Find Available Work

// turbo

1. List files in `.agent/tasks/backlog/`
2. Read each task file
3. Filter for tasks where:
   - All dependencies are in `done/`
   - The target zone is not currently owned
   - The task matches your capabilities

## Step 2: Claim the Task

1. Move the task file from `backlog/` to `active/`
2. Set "Claimed By" to your agent ID
3. Set "Status" to "active"
4. Update the zone's OWNERS.md with your claim
5. Create a git branch: `agent/TASK-{ID}`

## Step 3: Read Context

// turbo

1. Read the task file completely
2. Read the zone's CONTRACT.md
3. Read the zone's OWNERS.md (for dependencies)
4. Read all ADRs in `.agent/knowledge/decisions/`
5. Read relevant patterns in `.agent/knowledge/patterns/`
6. Read any existing feedback in `.agent/feedback/TASK-{ID}/`
7. Read relevant sections of docs/DESIGN_PRINCIPLES.md

## Step 4: Implement

1. Write code following established patterns
2. Write unit tests FIRST (TDD preferred)
3. Use templates from `.agent/templates/` where applicable
4. Stay within your owned zone — do NOT modify other zones
5. Keep diff under 500 lines (or limit specified in task)

## Step 5: Self-Verify

// turbo

1. Run `pnpm lint --filter=@acars/{zone}`
2. Run `pnpm typecheck --filter=@acars/{zone}`
3. Run `pnpm test --filter=@acars/{zone}`
4. If any fail, fix and re-verify before submitting

## Step 6: Submit

1. Commit with message: `feat(TASK-{ID}): {brief description}`
2. Push branch
3. Move task file from `active/` to `review/`
4. CI gates will run automatically

## Step 7: Handle Gate Results

- If ALL gates pass → task auto-merges, you're done
- If ANY gate fails → read `.agent/feedback/TASK-{ID}/gate-failure-N.md`
- Fix the issues and re-push (up to 3 attempts)
- After 3 failures → task moves to `failed/`, stop work
```

### 10.3 Visualization: The Dashboard

The human operator gets a real-time dashboard showing:

```
╔══════════════════════════════════════════════════════════════════╗
║  ACARS Agent Development Dashboard                             ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                 ║
║  ZONES          OWNER         TASK        STATUS                ║
║  ─────          ─────         ────        ──────                ║
║  @acars/core    agent-core    TASK-010    ██████░░ 75% done     ║
║  @acars/map     agent-map     TASK-012    ██░░░░░░ 25% done     ║
║  @acars/store   (available)   —           ░░░░░░░░ available    ║
║  @acars/nostr   (available)   —           ░░░░░░░░ available    ║
║  @acars/data    (available)   —           ░░░░░░░░ available    ║
║  apps/web       (available)   —           ░░░░░░░░ available    ║
║                                                                 ║
║  PIPELINE        BACKLOG: 24   ACTIVE: 4   DONE: 12   FAIL: 1  ║
║  TRUNK STATUS    ✅ GREEN (all gates passing)                    ║
║  LAST MERGE      3 minutes ago (TASK-009 by agent-infra)        ║
║  TEST COVERAGE   78.3% (+2.1% today)                            ║
║  TOTAL TASKS     41 defined, 12 complete, 29 remaining          ║
║                                                                 ║
║  RECENT ACTIVITY                                                ║
║  20:32  agent-core    pushed TASK-010 for review                ║
║  20:31  agent-ui      claimed TASK-011                          ║
║  20:28  agent-infra   TASK-009 ✅ merged (all gates passed)     ║
║  20:15  agent-map     TASK-008 ❌ gate failure (type error)     ║
║  20:14  agent-map     TASK-008 retry 1/3                        ║
║                                                                 ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Summary: The ACDP Promise

| Property               | How ACDP Delivers It                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Safe**               | Agents can't touch files outside their zone. Contracts can't be broken. Gates verify everything before merge.                                         |
| **Scalable**           | N agents work in parallel on N zones. No coordination overhead. Adding a new zone = adding a new parallel lane.                                       |
| **Fail-Safe**          | Every failure mode has an automatic response. Trunk is always green. Atomic rollback on post-merge failures. Dead man's switch prevents zombie locks. |
| **Context-Preserving** | ADRs, patterns, lessons, and task files persist knowledge across agent sessions. No "telephone game" — agents read artifacts, not each other.         |
| **Human-Friendly**     | Human creates tasks, reviews proposals, monitors dashboard. Never blocks the pipeline. Can intervene at any time.                                     |
| **Model-Agnostic**     | Works with any AI agent (Claude, GPT, Gemini, Codex, local models). The protocol is in the file system, not in any agent's memory.                    |
| **Evolvable**          | New zones can be added. New gate types can be added. New agent types can be registered. The system grows with the project.                            |

The entire paradigm lives in **files in the repo** — no external services, no databases, no orchestration servers. Git IS the orchestration layer. The file system IS the communication protocol. The CI pipeline IS the verification engine.

**This is infrastructure as code, applied to the development process itself.**
