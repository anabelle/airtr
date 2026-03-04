# @acars/store — Ownership Record

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
packages/store/
├── src/
│   ├── slices/
│   │   ├── engineSlice.ts
│   │   ├── fleetSlice.ts
│   │   ├── identitySlice.ts
│   │   ├── networkSlice.ts
│   │   └── worldSlice.ts
│   ├── airline.ts        ← Main store composition
│   ├── engine.ts         ← Engine store
│   ├── FlightEngine.ts   ← Flight simulation
│   ├── actionReducer.ts  ← Action processing
│   ├── actionChain.ts    ← Action chain management
│   ├── marketplaceReplay.ts
│   ├── scopeActions.ts
│   ├── hooks.ts
│   ├── types.ts
│   └── index.ts
├── CONTRACT.md
├── OWNERS.md
├── package.json
└── tsconfig.json
```

## Dependencies (zones this zone imports from)

- @acars/core (types, functions)
- @acars/data (catalogs)
- @acars/nostr (I/O)

## Dependents (zones that import from this zone)

- @acars/map
- apps/web

## Special Notes

- Store slices are internal implementation details.
- Only the public hooks and actions are part of the contract.
- Changes to action names/signatures require contract version bump.
