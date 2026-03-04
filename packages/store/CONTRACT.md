# @acars/store — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Exported Types

```typescript
// Re-exported from @acars/core
export type {
  AircraftInstance,
  AircraftModel,
  AirlineEntity,
  Airport,
  FixedPoint,
  Route,
  TimelineEvent,
  // ... etc
} from "@acars/core";

// Store-specific types
interface AirlineState {
  // Identity
  pubkey: string | null;
  airlineName: string | null;
  livery: { primary: string; secondary: string; accent: string } | null;

  // Fleet
  fleet: AircraftInstance[];

  // Network
  hubs: string[];
  activeHub: string | null;
  routes: Route[];

  // World (multi-player)
  competitors: Map<string, AirlineEntity>;
  fleetByOwner: Map<string, AircraftInstance[]>;
  routesByOwner: Map<string, Route[]>;

  // View state
  viewedPubkey: string | null;
}

interface EngineState {
  tick: number;
  tickProgress: number;
  isPaused: boolean;
  lastUpdate: number;
}
```

### Exported Hooks

```typescript
// Main airline store
function useAirlineStore(): AirlineState & AirlineActions;

// Engine store (tick management)
function useEngineStore(): EngineState & EngineActions;

// Convenience hooks
function useAircraft(aircraftId: string): AircraftInstance | undefined;
function useRoute(routeId: string): Route | undefined;
function useHubAirports(): Airport[];
function useCompetitorAirlines(): AirlineEntity[];
```

### Exported Store Instances

```typescript
const useAirlineStore: UseBoundStore<StoreApi<AirlineState>>;
const useEngineStore: UseBoundStore<StoreApi<EngineState>>;
```

### Store Actions (via useAirlineStore)

```typescript
// Identity
setPubkey(pubkey: string | null): void;
createAirline(name: string, livery: Livery, hubIata: string): Promise<void>;
loadFromNostr(): Promise<boolean>;

// Fleet
purchaseAircraft(modelId: string, customName?: string): Promise<void>;
sellAircraft(aircraftId: string): Promise<void>;
performMaintenance(aircraftId: string): void;
assignAircraftToRoute(aircraftId: string, routeId: string): void;
unassignAircraft(aircraftId: string): void;

// Network
addHub(iata: string): Promise<void>;
removeHub(iata: string): void;
switchActiveHub(iata: string): void;
openRoute(originIata: string, destIata: string, fares: Fares): Promise<void>;
closeRoute(routeId: string): Promise<void>;
updateRouteFares(routeId: string, fares: Fares): void;

// Engine
processTick(tick: number): Promise<void>;

// World (multi-player)
syncWorld(options?: { force?: boolean }): Promise<void>;
syncCompetitor(pubkey: string): Promise<void>;
projectCompetitorFleet(tick: number): void;
```

### Contract Rules

1. All exports listed above are FROZEN until a major version bump.
2. Store state shape is part of the contract.
3. Action names and signatures are part of the contract.
4. Internal implementation (slices, reducers) may change.
5. New actions may be added in minor versions.

### Dependencies

- `zustand` — State management
- `@acars/core` — Types and pure functions
- `@acars/data` — Static data catalogs
- `@acars/nostr` — Nostr I/O
