# ADR-003: Use Zustand for State Management

## Status: ACCEPTED
## Date: 2026-02-20

## Context
The application needs state management that supports:
- Multiple independent stores (one per domain)
- React hook-based API
- Minimal boilerplate
- Good performance with frequent updates (aircraft positions)
- Compatible with a modular/plugin architecture

Options evaluated:
1. **Redux Toolkit** — Mature, verbose, single store
2. **Zustand** — Minimal, multiple stores, hook-based
3. **Jotai** — Atomic, bottom-up, good for fine-grained reactivity
4. **MobX** — Observable-based, more opinionated

## Decision
Use Zustand with multiple small, domain-specific stores.

## Rationale
- Multiple stores align perfectly with our bounded context architecture
- Each zone can own its own store without coupling
- Hook-based API is idiomatic React
- Minimal API surface — less for agents to learn
- Excellent performance with selectors for preventing unnecessary rerenders
- Easy to serialize/deserialize for Nostr persistence

## Store Design
```typescript
// Each domain gets its own store
const useMapStore = create<MapState>(...)      // Camera, zoom, selection
const useAirlineStore = create<AirlineState>(...) // Player's airline
const useWorldStore = create<WorldState>(...)   // Global state
const useNostrStore = create<NostrState>(...)   // Connection, identity
const useUIStore = create<UIState>(...)         // Panels, modals, view mode
```

## Consequences
- ✅ Clean separation of concerns
- ✅ Each store can be tested independently
- ✅ Stores can subscribe to each other via middleware
- ✅ Easy to add new stores for plugins/modules
- ⚠️ Cross-store coordination requires explicit subscription patterns
- 🚫 Do NOT create a single monolithic store
- 🚫 Do NOT import stores from zones that don't list them as dependencies
