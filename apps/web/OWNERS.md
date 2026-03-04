# apps/web — Ownership Record

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
apps/web/
├── src/
│   ├── app/              ← Global app setup
│   ├── routes/           ← TanStack Router routes
│   ├── shared/           ← Reusable UI components
│   │   ├── components/
│   │   └── lib/
│   └── features/         ← Core game modules
│       ├── identity/
│       ├── corporate/
│       ├── fleet/
│       └── network/
├── CONTRACT.md
├── OWNERS.md
├── package.json
└── vite.config.ts
```

## Dependencies (zones this zone imports from)

- @acars/core
- @acars/data
- @acars/nostr
- @acars/store
- @acars/map

## Dependents (zones that import from this zone)

- None (this is the top-level application)

## Special Notes

- This zone has the most frequent changes.
- Feature modules should be self-contained.
- Changes to routes affect user bookmarks (stability required).
