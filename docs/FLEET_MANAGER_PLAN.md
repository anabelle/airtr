# AirTR — Fleet Manager Implementation Plan
## Blueprint for Fail-Safe, Extensible, and Accurate Fleet Operations

This document details the architecture and implementation strategy for the **Fleet Manager** module. This is the critical transition point where AirTR evolves from a tech demo into a deterministic, event-sourced game economy.

---

## 1. Architectural Philosophy & Invariants

To maintain the "Forever Architecture" and deterministic nature of the game:

1. **No "God Mode" Balances**: Your bank balance is **never** saved directly. It is a strictly derived value: `InitialBalance - sum(Purchases) + sum(TickProfits)`.
2. **Event-Sourced Actions**: Buying an aircraft is not a REST API call or a local state mutation. It is a signed Nostr event (`kind: 30079` or similar parameterized replaceable/ephemeral event) added to your airline's timeline.
3. **Pure Rule Validation**: The decision of "can I buy this plane?" lives entirely in `@airtr/core`, totally isolated from UI or network states.
4. **Strict Types**: Aircraft models are static, immutable catalogs provided by `@airtr/data`.

---

## 2. Data Structures & Catalogs

### 2.1 The Aircraft Catalog (`@airtr/data/src/aircraft.ts`)
We need a robust catalog of aircraft that balances realism with gameplay progression.

```typescript
export interface AircraftModel {
    id: string;               // e.g., "b737-800"
    manufacturer: string;     // e.g., "Boeing"
    name: string;             // e.g., "737-800"
    type: 'turboprop' | 'regional' | 'narrowbody' | 'widebody';
    
    // Specifications
    rangeKm: number;          // Max range in kilometers
    speedKmh: number;         // Cruising speed
    capacity: {
        economy: number;
        business: number;
        first: number;
    };
    
    // Economics (using FixedPoint for $ values)
    price: FixedPoint;        // Purchase price (e.g., $50,000,000)
    monthlyLease: FixedPoint; // For future leasing mechanics
    fuelPerKm: number;        // kg of fuel burnt per km
    maintCostPerHour: FixedPoint; // Maintenance cost per block hour
    crewRequired: number;     // Number of crew members needed
    
    // Game Progression
    unlockTier: number;       // Which tier is required to buy this
}
```

*Initial MVP Catalog:*
- **ATR 72-600** (Turboprop, cheap, short range, Tier 1)
- **A220-300** (Regional, efficient, medium range, Tier 1)
- **B737-800 / A320neo** (Narrowbody, workhorses, Tier 1/2)
- **A330-300 / B787-9** (Widebody, long range, Tier 2/3)

### 2.2 The Fleet Instance (`@airtr/core/src/types.ts`)
When a player buys an aircraft, it becomes a specific instance assigned to their airline.

```typescript
export interface AircraftInstance {
    id: string;               // Unique universally (e.g., hash of purchase event)
    ownerPubkey: string;      // The airline's Nostr pubkey
    modelId: string;          // Reference to AircraftModel.id
    name: string;             // User-assigned name (e.g., "Spirit of Satoshi")
    status: 'idle' | 'assigned' | 'maintenance';
    assignedRouteId: string | null; 
    purchasedAtTick: number;  // For age/depreciation calculations
}
```

---

## 3. The Nostr Action Layer

All game actions must be codified as signed events.

### 3.1 Game Action Event Schema
Instead of creating a new NIP per action, we use a structured payload inside a specific event kind (e.g., `kind: 30080` for Game Actions).

```json
{
  "kind": 30080,
  "tags": [
    ["d", "airtr:action:buy_aircraft"],
    ["airline", "<airline_pubkey>"]
  ],
  "content": {
    "action": "BUY_AIRCRAFT",
    "payload": {
      "modelId": "b737-800",
      "customName": "Spirit of Freedom",
      "expectedPrice": 500000000000 // FixedPoint verification to prevent race conditions
    }
  }
}
```

### 3.2 Action Validators (`@airtr/core/src/actions.ts`)
A pure function that deeply validates if an action is legal.

```typescript
export function validateAircraftPurchase(
    state: GameState, 
    pubkey: string, 
    modelId: string
): ValidationResult {
    const airline = state.getAirline(pubkey);
    const model = AircraftCatalog[modelId];
    
    if (!airline) return { valid: false, reason: "Airline not found" };
    if (!model) return { valid: false, reason: "Unknown aircraft model" };
    
    // The most critical check: derivation of balance ensures no cheating
    const currentBalance = calculateBalance(state, pubkey);
    
    if (currentBalance < model.price) {
        return { valid: false, reason: "Insufficient funds" };
    }
    
    if (airline.tier < model.unlockTier) {
        return { valid: false, reason: "Tier requirement not met" };
    }
    
    return { valid: true };
}
```

---

## 4. The Tick Processor Integration

The fleet directly impacts the deterministic tick.

### 4.1 Balance Derivation (The Anti-Cheat Mechanism)
Your balance is calculated on the fly:
`Balance = StartingCapital(100M) - Purchases + TotalRouteProfits`

During a tick:
1. Engine loops over all active, assigned routes.
2. Looks up the `AircraftInstance` assigned to that route.
3. Calculates Revenue (Pax × Fare).
4. Calculates Costs using the specific `AircraftModel`'s fuel burn, crew needs, and maintenance rates based on the route distance.
5. Applies the net profit to the airline's ledger.

---

## 5. UI/UX: The Fleet Manager Interface

The user interface must feel premium, aviation-authentic, and highly tactical.

### 5.1 The Aircraft Showroom (Purchasing)
- **Visuals**: A clean, grid-based or horizontal scrolling list of available aircraft models.
- **Data Display**: Clear badging for Range, Seats, and Cost-per-km efficiency.
- **Interaction**: Selecting an aircraft shows a detailed spec sheet. Clicking "Purchase" triggers the Nostr signing flow.
- **Feedback**: Immediate local optimistic update (bank balance drops, plane appears in fleet), followed by background Nostr broadcast.

### 5.2 The Hangar (Fleet Management)
- **List View**: Shows all owned `AircraftInstance`s.
- **Status Indicators**: Colored pill badges indicating `[ IDLE ]` (yellow), `[ FLYING: JFK→LHR ]` (green), or `[ MAINTENANCE ]` (red).
- **Actions**:
  - Rename Aircraft
  - Assign to Route (opens the Route Maker panel)
  - Sell Aircraft (recovers depreciated value)

---

## 6. Implementation Steps (Execution Order)

1. **`@airtr/data`**: Define `AircraftModel` types and populate the `aircraft.ts` catalog with ~6 realistic starter planes.
2. **`@airtr/core`**: Build `fleet.ts` containing the structural types (`AircraftInstance`) and the pure validation logic (`validateAircraftPurchase`).
3. **`@airtr/nostr`**: Update `schema.ts` to export `publishGameAction()` and a generic game action listener that pushes events into a queue.
4. **`@airtr/store`**: Update the Zustand engine to digest Nostr action events, applying them predictably to the local state (deducting balance, adding to fleet array).
5. **`apps/web`**: Build `FleetManager.tsx` UI component with a "Showroom" Tab and a "Hangar" Tab, wiring it up to the Zustand store.

This architecture ensures that if the Nostr relay drops, the local engine handles the state deterministically, and upon reconnection, the true event ledger synchronizes perfectly.
