# apps/web — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Description

The main web application built with Vite + React 19 + TanStack Router.

### Exported Features

This is an application, not a library. It does not export TypeScript modules.

Instead, it provides:

1. **Routes** (TanStack Router file-based):
   - `/` — Home/Dashboard
   - `/network` — Route management
   - `/fleet` — Fleet management
   - `/identity` — Airline identity
   - `/competition` — Leaderboard

2. **Feature Modules** (Feature-Sliced Design):
   - `features/identity/` — Nostr login, NIP-07
   - `features/corporate/` — Stock charts, M&A (planned)
   - `features/fleet/` — Buy/sell aircraft, maintenance
   - `features/network/` — Route creation, hubs, map overlays

3. **Shared Components** (shadcn/ui pattern):
   - `shared/components/` — Button, Card, Dialog, etc.
   - `shared/lib/` — Utilities, cn() for Tailwind

### Contract Rules

1. Route paths are FROZEN (URL stability).
2. Feature module boundaries are soft recommendations.
3. Shared components may be added/modified in minor versions.
4. Breaking UI changes require human approval.

### Dependencies

- All workspace packages (@acars/core, @acars/data, @acars/nostr, @acars/store, @acars/map)
- React 19
- TanStack Router
- TanStack Virtual
- Tailwind CSS
- Radix UI
- Lucide Icons
- MapLibre GL
