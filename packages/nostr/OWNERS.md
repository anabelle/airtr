# @acars/nostr — Ownership Record

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
packages/nostr/
├── src/
│   ├── identity.ts      ← NIP-07, key management
│   ├── ndk.ts           ← NDK connection management
│   ├── schema.ts        ← Event types, publishing, loading
│   └── index.ts
├── CONTRACT.md
├── OWNERS.md
├── package.json
└── tsconfig.json
```

## Dependencies (zones this zone imports from)

- @acars/core (types: FixedPoint, Checkpoint, GameActionType)

## Dependents (zones that import from this zone)

- @acars/store
- apps/web

## Special Notes

- Changes to event schemas (kinds 30078, 30079) require coordination.
- Relay URLs are configurable, not hardcoded.
- Must maintain backward compatibility with existing events.
