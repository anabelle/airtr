# @acars/core — Ownership Record

## Current Owner

- **Agent**: (unclaimed)
- **Since**: —
- **Task**: —

## Ownership Rules

- Only the listed agent may create, modify, or delete files in this zone.
- Ownership is acquired by claiming a task that targets this zone.
- Ownership is released when the task is completed and merged.
- The human operator can override ownership at any time.

## Read-Only Access

All agents may READ files in this zone at any time.
Reading never requires ownership.

## Zone Boundaries

```text
packages/core/
├── src/
│   ├── checkpoint.ts
│   ├── cycle.ts
│   ├── demand.ts
│   ├── finance.ts
│   ├── fixed-point.ts
│   ├── fleet.ts
│   ├── geo.ts
│   ├── hub.ts
│   ├── logger.ts
│   ├── prng.ts
│   ├── qsi.ts
│   ├── season.ts
│   ├── solar.ts
│   ├── types.ts
│   └── index.ts
├── CONTRACT.md
├── OWNERS.md
├── package.json
└── tsconfig.json
```

## Dependencies (zones this zone imports from)

- None (zero external runtime dependencies)

## Dependents (zones that import from this zone)

- @acars/data
- @acars/store
- @acars/nostr
- @acars/map
- apps/web

## Special Notes

- This is the most critical zone — all economic math lives here.
- Changes must maintain determinism (see ADR-002).
- No floating-point for financial values.
- No unseeded randomness.
