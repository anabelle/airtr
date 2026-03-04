# @acars/data — Ownership Record

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

```
packages/data/
├── src/
│   ├── airports.ts      ← OpenFlights airport data (auto-generated)
│   ├── aircraft.ts      ← Aircraft model catalog
│   ├── geo.ts           ← Geographic utilities
│   ├── hubs.ts          ← Hub classifications and pricing
│   └── index.ts
├── CONTRACT.md
├── OWNERS.md
├── package.json
└── tsconfig.json
```

## Dependencies (zones this zone imports from)

- @acars/core (types: Airport, AircraftModel, HubTier, FixedPoint)

## Dependents (zones that import from this zone)

- @acars/store
- @acars/nostr
- apps/web

## Special Notes

- `airports.ts` is auto-generated from OpenFlights data.
- `aircraft.ts` should only be modified with real-world data.
- Hub classifications in `hubs.ts` are based on real airport data.
