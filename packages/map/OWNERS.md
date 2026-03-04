# @acars/map — Ownership Record

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
packages/map/
├── src/
│   ├── Globe.tsx        ← Main MapLibre globe component
│   ├── icons.ts         ← Aircraft family SVG icons
│   ├── geo.ts           ← Geographic utilities
│   └── index.ts
├── CONTRACT.md
├── OWNERS.md
├── package.json
└── tsconfig.json
```

## Dependencies (zones this zone imports from)

- @acars/core (types: AircraftInstance, Airport)
- @acars/store (state subscriptions)

## Dependents (zones that import from this zone)

- apps/web

## Special Notes

- MapLibre layer names and sources are internal implementation.
- Only the Globe component API is part of the contract.
- Icon SVG paths are part of visual identity (frozen).
