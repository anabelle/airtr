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
    generation: 'legacy' | 'modern' | 'nextgen';  // Affects efficiency & costs
    
    // Specifications (real aviation data)
    rangeKm: number;          // Max range in kilometers
    speedKmh: number;         // Cruising speed
    maxTakeoffWeight: number; // kg - affects runway requirements
    capacity: {
        economy: number;
        business: number;
        first: number;
        cargoKg: number;      // Cargo capacity in kg
    };
    
    // Operational Economics
    fuelBurnKgPerHour: number;    // Actual fuel burn at cruise
    fuelBurnKgPerKm: number;      // Derived: fuel per km
    blockHoursPerDay: number;     // Typical utilization (8-14 hrs)
    turnaroundTimeMinutes: number; // Min time between flights
    
    // Cost Structure (IATA 2023 benchmarks)
    price: FixedPoint;            // Purchase price
    monthlyLease: FixedPoint;     // Lease rate (~0.5-0.8% of value/month)
    casm: FixedPoint;             // Cost per Available Seat Mile (cents)
    maintCostPerHour: FixedPoint; // Maintenance cost per block hour
    crewRequired: {
        cockpit: number;          // Pilots (2 for most, 3 for older widebodies)
        cabin: number;            // Flight attendants (1 per 50 pax typically)
    };
    
    // Lifecycle
    economicLifeYears: number;    // 20-25 years typical
    residualValuePercent: number; // 10-15% after full life
    
    // Game Progression
    unlockTier: number;
    familyId: string;             // For commonality bonuses (e.g., "a320", "b737")
}
```

*MVP Catalog with Real Data (Sources: IATA MCX 2023, Boeing/Airbus specs):*

| Aircraft | Type | Seats | Range km | Price | CASM | Blk Hrs | Turn min | Family |
|----------|------|-------|----------|-------|------|---------|----------|--------|
| ATR 72-600 | Turboprop | 70 | 1,528 | $26M | $0.18 | 8-10 | 25 | atr |
| Dash 8-Q400 | Turboprop | 78 | 2,037 | $32M | $0.16 | 8-10 | 25 | dash8 |
| A220-300 | Regional | 135 | 6,300 | $55M | $0.10 | 11-12 | 30 | a220 |
| E190-E2 | Regional | 114 | 5,300 | $53M | $0.11 | 11-12 | 30 | ejet |
| A320neo | Narrowbody | 180 | 6,300 | $110M | $0.08 | 12-13 | 35 | a320 |
| B737-800 | Narrowbody | 189 | 5,765 | $106M | $0.09 | 12-13 | 35 | b737 |
| B737 MAX 8 | Narrowbody | 178 | 6,570 | $121M | $0.07 | 12-13 | 35 | b737 |
| A321neo | Narrowbody | 244 | 7,400 | $129M | $0.07 | 12-13 | 40 | a320 |
| A330-900 | Widebody | 293 | 13,300 | $296M | $0.06 | 13-14 | 60 | a330 |
| B787-9 | Widebody | 290 | 14,140 | $292M | $0.05 | 13-14 | 55 | b787 |

**Key Insight from Real Airlines:** Low-cost carriers (Ryanair, Southwest) achieve 13-14 block hours/day through quick turnarounds (15-25 min). Hub-and-spoke carriers typically achieve 10-12 hours due to connection timing constraints.

### 2.2 The Fleet Instance (`@airtr/core/src/types.ts`)
When a player buys an aircraft, it becomes a specific instance assigned to their airline.

```typescript
export interface AircraftInstance {
    id: string;               // Unique universally (e.g., hash of purchase event)
    ownerPubkey: string;      // The airline's Nostr pubkey
    modelId: string;          // Reference to AircraftModel.id
    name: string;             // User-assigned name (e.g., "Spirit of Satoshi")
    status: 'idle' | 'enroute' | 'turnaround' | 'delivery' | 'maintenance';
    assignedRouteId: string | null; 
    purchasedAtTick: number;  // For age/depreciation calculations
    
    // Wear and Tear Mechanics
    flightHoursTotal: number; // Total hours flown in its lifetime
    flightHoursSinceCheck: number; // Hours since last A-Check
    condition: number;        // 0.0 to 1.0 (1.0 = brand new). Affects QSI Service Score and fuel burn.
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
6. Increases `flightHoursTotal` and `flightHoursSinceCheck` for the aircraft.
7. Degrades the aircraft `condition` proportionally to the hours flown.

### 4.2 Wear & Tear and Maintenance Mechanics
Aircraft are depreciating assets that require constant upkeep. If ignored, they cost you passengers and money.

1. **Condition Degradation**: Every hour flown slightly lowers the `condition` score.
2. **Impact of Poor Condition**: 
   - **Fuel Burn Penalty**: A plane at 0.5 condition burns 10% more fuel than a new one.
   - **QSI Service Penalty**: Passengers don't like ragged planes. Low condition drops your Service Score in the QSI model, losing you market share.
3. **A-Checks (Routine Maintenance)**: 
   - Required every X flight hours (e.g., 500 hours).
   - If `flightHoursSinceCheck` exceeds the limit, the aircraft is **forcibly grounded** (`status = 'maintenance'`) until it undergoes a check.
   - Checks cost money and take real time (e.g., grounded for 24 hours).
   - Resets `flightHoursSinceCheck` to 0 and slightly restores `condition`.
4. **C-Checks / Overhauls**:
   - A major manual action that heavily restores `condition` but costs a fortune and grounds the plane for days.

### 4.3 Aircraft Utilization (The Profit Multiplier)
*"Airplanes only make money when they're flying."*

Utilization is the #1 driver of airline profitability. A plane on the ground is burning money (ownership costs, parking fees) without generating revenue.

#### Utilization Formula
```
Utilization (hrs/day) = (Total Block Hours) / (Days in Service)

Where:
- Block Hours = Gate-to-gate time (taxi + flight + taxi)
- Days in Service = Total days minus maintenance/grounding days
```

#### Industry Benchmarks (IATA 2023)
| Airline Type | Utilization | Strategy |
|--------------|-------------|----------|
| Low-Cost (Ryanair, Southwest) | 13-14 hrs/day | Quick turns (15-25 min), point-to-point |
| Legacy Carriers | 10-12 hrs/day | Hub-and-spoke, connection delays |
| Regional | 8-10 hrs/day | Short routes, more ground time ratio |
| Long-Haul | 13-15 hrs/day | Fewer flights, longer sectors |

#### Game Mechanics
1. **Turnaround Time**: Each aircraft type has a minimum turnaround (see catalog). Players can:
   - Accept default (standard operation)
   - Pay extra for "Quick Turn" (-5 min, +10% ground crew costs)
   - Suffer delays (+10-30 min) if understaffed or bad weather

2. **Utilization Score**: Displayed per aircraft and fleet-wide.
   - < 8 hrs/day: "Underutilized" (wasted asset)
   - 10-12 hrs/day: "Healthy"
   - > 13 hrs/day: "High Utilization" (risk of maintenance issues)

3. **Overutilization Risk**: Pushing > 14 hrs/day consistently increases:
   - Unscheduled maintenance probability (+20%)
   - Crew fatigue (crew delays, cancellations)
   - AOG (Aircraft on Ground) events: $10,000-$150,000/hour cost

#### Daily Flight Capacity Calculation
```typescript
function calculateDailyFlights(
    route: Route,
    aircraft: AircraftModel
): number {
    const blockHours = route.blockTimeHours;
    const turnaround = aircraft.turnaroundTimeMinutes / 60;
    const cycleHours = blockHours + turnaround;
    const maxFlights = Math.floor(aircraft.blockHoursPerDay / cycleHours);
    return maxFlights;
}

// Example: LAX-SFO (1.0 hr block), B737-800 (35 min turn)
// cycleHours = 1.0 + 0.58 = 1.58 hrs
// maxFlights = 12.5 / 1.58 = 7 flights/day
```

### 4.4 Fleet Commonality (Strategic Depth)
*"Why Ryanair and Southwest bet everything on one aircraft type."*

Fleet commonality is one of the most powerful strategic decisions an airline makes. Standardizing on a single aircraft family creates massive operational efficiencies.

#### Real-World Examples
| Airline | Fleet | Commonality | Result |
|---------|-------|-------------|--------|
| Ryanair | 270+ B737s | 100% Boeing 737 | Lowest CASM in Europe |
| Southwest | 800+ B737s | 100% Boeing 737 | 50+ years profitable |
| easyJet | 300+ A320s | 100% Airbus A320 family | Major cost advantage |
| Emirates | 270 aircraft | Mixed (777 + A380) | Higher costs, but network flexibility |

#### Commonality Benefits (Game Mechanics)
When an airline has multiple aircraft of the same `familyId`:

| Metric | Benefit | Threshold |
|--------|---------|-----------|
| **Crew Training** | -15% pilot training costs | 3+ same family |
| **Spare Parts** | -20% parts inventory costs | 5+ same family |
| **Maintenance** | -10% maintenance labor | 5+ same family |
| **Fleet Swaps** | Enable aircraft swaps for disruptions | 3+ same family on same routes |
| **Resale Value** | +5% residual value | Fleet of 10+ same type |

#### Commonality Calculation
```typescript
interface FleetCommonalityBonus {
    crewTrainingDiscount: number;    // 0-15%
    partsDiscount: number;           // 0-20%
    maintenanceDiscount: number;     // 0-10%
    swapEnabled: boolean;
}

function calculateCommonalityBonus(
    fleet: AircraftInstance[],
    aircraftCatalog: Record<string, AircraftModel>
): FleetCommonalityBonus {
    const familyCounts: Record<string, number> = {};
    
    for (const aircraft of fleet) {
        const model = aircraftCatalog[aircraft.modelId];
        familyCounts[model.familyId] = (familyCounts[model.familyId] || 0) + 1;
    }
    
    const dominantFamily = Object.entries(familyCounts)
        .sort((a, b) => b[1] - a[1])[0];
    
    const count = dominantFamily?.[1] || 0;
    const totalFleet = fleet.length;
    const commonalityRatio = count / totalFleet;
    
    return {
        crewTrainingDiscount: count >= 3 ? 15 * commonalityRatio : 0,
        partsDiscount: count >= 5 ? 20 * commonalityRatio : 0,
        maintenanceDiscount: count >= 5 ? 10 * commonalityRatio : 0,
        swapEnabled: count >= 3,
    };
}
```

#### Strategic Trade-off
**Commonality vs Flexibility:**
- **All one family**: Maximum cost efficiency, but limited range/capacity options
- **Mixed fleet**: Full flexibility, but higher training, parts, and maintenance costs
- **Game design**: Neither is "correct" — player must choose based on their network strategy

### 4.5 Maintenance System (A/B/C/D Checks)
*"An aircraft on ground costs $10,000-$150,000 per hour."*

Real airlines follow a structured maintenance program based on flight hours and cycles. Poor planning leads to AOG (Aircraft on Ground) events that devastate profits.

#### Maintenance Check Types (Real Aviation)

| Check | Interval | Duration | Cost | What It Covers |
|-------|----------|----------|------|----------------|
| **A-Check** | 500-600 FH | 1-2 days | $50K-$100K | Routine inspections, fluid changes, minor repairs |
| **B-Check** | 6-8 months | 1-3 days | $100K-$200K | More detailed systems checks (often combined with A) |
| **C-Check** | 18-24 months | 1-2 weeks | $500K-$1M | Heavy structural inspection, paint, interior |
| **D-Check** | 6-10 years | 4-6 weeks | $2M-$4M | Complete teardown, overhaul, "the works" |

#### Game Implementation

```typescript
interface MaintenanceSchedule {
    aircraftId: string;
    lastACheck: number;      // Flight hours
    lastCCheck: number;      // Flight hours
    lastDCheck: number;      // Flight hours
    totalCycles: number;     // Takeoffs/landings
    nextRequiredCheck: 'A' | 'C' | 'D' | null;
    hoursUntilRequired: number;
}

interface MaintenanceCheckResult {
    groundedTicks: number;   // How long out of service
    cost: FixedPoint;
    conditionRestored: number; // How much condition is restored
    dispatchReliability: number; // Chance of post-check issues
}

function calculateMaintenanceCost(
    model: AircraftModel,
    checkType: 'A' | 'B' | 'C' | 'D',
    condition: number
): FixedPoint {
    const baseCosts = {
        A: 75000,
        B: 150000,
        C: 750000,
        D: 3000000,
    };
    
    // Poor condition = more expensive maintenance
    const conditionMultiplier = 1 + (1 - condition) * 0.5;
    
    // Larger aircraft = higher costs
    const sizeMultiplier = model.type === 'widebody' ? 2.5 
                         : model.type === 'narrowbody' ? 1.5 
                         : 1.0;
    
    return baseCosts[checkType] * conditionMultiplier * sizeMultiplier;
}
```

#### Maintenance Planning UI
Players must balance:
1. **Opportunity Cost**: Every day grounded = lost revenue
2. **Timing**: Schedule during low-demand periods (off-peak seasons)
3. **Fleet Buffer**: Keep spare aircraft to maintain schedule during checks
4. **Condition Penalty**: Delaying maintenance increases costs and risks

#### AOG (Aircraft on Ground) Events
Random mechanical failures that force unscheduled maintenance:
- **Probability**: Increases with condition degradation
- **Cost**: $10,000-$150,000/hour (depending on aircraft size)
- **Duration**: 4-48 hours depending on issue
- **Reputation Impact**: -0.01 brand score per cancellation

### 4.6 Depreciation & Residual Value
*"Aircraft lose value faster than you think."*

Aircraft are depreciating assets. Understanding residual value is critical for fleet planning and exit strategies.

#### Depreciation Model (Straight-Line)
Real airlines typically depreciate over 20-25 years with 10-15% residual value:

```
Annual Depreciation = (Purchase Price - Residual Value) / Useful Life

Example: B737-800 ($106M, 25-year life, 10% residual)
Annual Depreciation = ($106M - $10.6M) / 25 = $3.8M/year
Monthly Depreciation = $316K/month
```

#### Book Value Calculation
```typescript
function calculateBookValue(
    model: AircraftModel,
    flightHoursTotal: number,
    condition: number,
    purchasedAtTick: number,
    currentTick: number
): FixedPoint {
    const ticksPerYear = 365; // Assuming daily ticks
    const ageYears = (currentTick - purchasedAtTick) / ticksPerYear;
    
    // Straight-line depreciation
    const residualValue = model.price * (model.residualValuePercent / 100);
    const depreciableBase = model.price - residualValue;
    const annualDepreciation = depreciableBase / model.economicLifeYears;
    
    let bookValue = model.price - (annualDepreciation * ageYears);
    
    // Condition adjustment: poor condition reduces value further
    const conditionPenalty = (1 - condition) * 0.3; // Up to 30% additional loss
    bookValue = bookValue * (1 - conditionPenalty);
    
    // High hours penalty (above average utilization)
    const averageAnnualHours = model.blockHoursPerDay * 365;
    const actualAnnualHours = flightHoursTotal / Math.max(ageYears, 0.1);
    if (actualAnnualHours > averageAnnualHours * 1.2) {
        bookValue = bookValue * 0.9; // 10% penalty for overutilization
    }
    
    // Floor at residual value
    return Math.max(bookValue, residualValue);
}
```

#### Residual Value Factors
| Factor | Impact on Residual |
|--------|-------------------|
| Popular model (737, A320) | +5-10% higher |
| Out of production | -10-20% lower |
| Poor condition (< 0.7) | -15-25% lower |
| High hours (> average) | -10% lower |
| Recent D-Check completed | +5% higher |

### 4.7 Used Aircraft Market
*"Sometimes buying used is smarter than new."*

Inspired by AirlineSim and Airlines Manager, a used aircraft market adds strategic depth. Players can buy/sell aircraft from each other or from NPC lessors.

#### Market Sources
1. **Player-to-Player**: Airlines selling excess aircraft
2. **NPC Lessors**: Leased aircraft returned to lessors enter the market
3. **Bankruptcy Sales**: Failed airlines' fleets liquidated at discount
4. **Manufacturer Pre-Owned**: Refurbished factory aircraft

#### Listing Structure
```typescript
interface AircraftListing {
    id: string;
    aircraft: AircraftInstance;
    sellerPubkey: string | 'lessor' | 'bankruptcy';
    askingPrice: FixedPoint;
    listedAtTick: number;
    auctionEndTick?: number;  // For bankruptcy auctions
    instantBuyPrice?: FixedPoint;
}
```

#### Market Dynamics
| Source | Price | Condition | Risk |
|--------|-------|-----------|------|
| Player Sale | 85-100% book value | Disclosed | Low (records visible) |
| Leaser | 90-95% book value | Good (maintained) | Low |
| Bankruptcy | 60-80% book value | Unknown | High (hidden damage) |
| Manufacturer | 80-90% of new | Refurbished | Low (warranty) |

#### Strategic Considerations
- **New vs Used**: New = high upfront, low maintenance. Used = lower upfront, higher risk.
- **Quick Expansion**: Used market allows rapid fleet growth vs 6-12 month wait for new
- **Exit Strategy**: Selling used aircraft when downsizing or upgrading
- **Bargain Hunting**: Bankruptcy auctions can yield 40% discounts

---

## 5. UI/UX: The Fleet Manager Interface

The user interface must feel premium, aviation-authentic, and highly tactical.

### 5.1 The Aircraft Showroom (Purchasing)
- **Visuals**: A clean, grid-based or horizontal scrolling list of available aircraft models.
- **Data Display**: Clear badging for Range, Seats, and Cost-per-km efficiency.
- **Interaction**: Selecting an aircraft shows a detailed spec sheet. Clicking "Purchase" triggers the Nostr signing flow.
- **Feedback**: Immediate local optimistic update (bank balance drops, plane appears in fleet), followed by background Nostr broadcast.
- **Comparison Tool**: Side-by-side compare 2-3 aircraft (inspired by AirlineSim's detailed specs)
- **CASM Calculator**: Show estimated cost-per-seat-mile based on typical route distance

### 5.2 The Hangar (Fleet Management)
- **List View**: Shows all owned `AircraftInstance`s.
- **Status Indicators**: Colored pill badges indicating `[ IDLE ]` (yellow), `[ FLYING: JFK→LHR ]` (green), or `[ MAINTENANCE ]` (red).
- **Condition & Hours**: Progress bars showing current `condition` and hours until next required maintenance check.
- **Actions**:
  - Rename Aircraft
  - Assign to Route / Unassign
  - Schedule Maintenance (A-Check / Overhaul)
  - Sell Aircraft (recovers depreciated value based on total flight hours and condition)
- **Fleet Metrics Dashboard**: 
  - Average utilization (hrs/day)
  - Fleet commonality score
  - Total maintenance hours scheduled
  - Average fleet age (inspired by Airlines Manager's fleet overview)

### 5.3 Used Aircraft Marketplace
- **Browse Tabs**: Player Listings | Leaser Inventory | Bankruptcy Auctions
- **Listing Cards**: Aircraft thumbnail, key stats, price, seller rating
- **Detailed View**: Full maintenance history, condition report, hours/cycles
- **Auction System**: Time-limited bidding on bankruptcy liquidations (inspired by AirlineSim's used market)

### 5.4 Performance Analytics Panel
Key metrics visible at a glance (inspired by real airline dashboards):
- **CASM vs RASM**: Cost vs Revenue per Available Seat Mile
- **Break-Even Load Factor**: What % of seats must fill to cover costs
- **Utilization by Aircraft Type**: Identify underperforming assets
- **Maintenance Cost Trend**: Spot aging fleet issues early

---

## 6. Implementation Steps (Execution Order)

### Phase 1: Core Data & Types
1. **`@airtr/data`**: Define enhanced `AircraftModel` types with utilization, CASM, family ID, and lifecycle fields. Populate `aircraft.ts` catalog with 10 realistic planes from the table above.
2. **`@airtr/core`**: Build `fleet.ts` containing:
   - `AircraftInstance` type with condition and maintenance tracking
   - `validateAircraftPurchase` pure function
   - `calculateBookValue` for depreciation
   - `calculateCommonalityBonus` for fleet efficiency

### Phase 2: Maintenance & Utilization
3. **`@airtr/core`**: Build `maintenance.ts` containing:
   - `MaintenanceSchedule` type
   - `calculateMaintenanceCost` function
   - A/B/C/D check interval logic
   - AOG event probability calculation
4. **`@airtr/core`**: Build `utilization.ts` containing:
   - `calculateDailyFlights` function
   - `calculateUtilizationScore` function
   - Turnaround time modifiers

### Phase 3: Nostr Integration
5. **`@airtr/nostr`**: Update `schema.ts` to export:
   - `publishGameAction()` for aircraft buy/sell/maintenance
   - Game action listener for event queue
   - Marketplace listing event types (kind 30081 for listings)

### Phase 4: State Management
6. **`@airtr/store`**: Update Zustand engine:
   - Fleet store with aircraft instances
   - Maintenance schedule store
   - Marketplace listings store
   - Derived selectors for CASM, RASM, utilization metrics

### Phase 5: UI Implementation
7. **`apps/web`**: Build `FleetManager.tsx` with tabs:
   - Showroom (new aircraft purchase)
   - Hangar (fleet management)
   - Marketplace (used aircraft)
   - Analytics (CASM/RASM/Utilization)
8. **`apps/web`**: Build `AircraftCard.tsx` component showing:
   - Status, condition, hours
   - Next maintenance due
   - Current assignment
   - Quick actions (assign, maintain, sell)

### Phase 6: Testing & Determinism
9. **`@airtr/core`**: Write determinism tests:
   - Replay 1000 ticks with fleet operations
   - Verify book value calculations match expected
   - Verify maintenance scheduling is deterministic
10. **`@airtr/core`**: Write unit tests for:
    - Commonality bonus calculations
    - Depreciation formulas
    - AOG probability

---

## 7. Alignment with Roadmap & Design Bible

### Roadmap Coverage
| Roadmap Task | Fleet Manager Support |
|--------------|----------------------|
| T-022 (Aircraft catalog) | Section 2.1 provides complete spec |
| T-084 (Aircraft purchase UI) | Section 5.1 defines UX |
| T-085 (Flight scheduling) | Section 4.3 utilization system |
| Phase 5 (Multiplayer) | Section 4.7 player-to-player market |

### Design Bible Alignment
| Design Principle | Fleet Manager Implementation |
|------------------|------------------------------|
| Simple rules, emergent complexity | Commonality bonuses create strategic depth |
| Visible systems | CASM/RASM dashboards, condition bars |
| Your world grows | Fleet composition affects network efficiency |
| Zen and tension | Maintenance planning is gentle pressure |
| Real-world grounding | All data from IATA/Boeing/Airbus specs |

---

This architecture ensures that if the Nostr relay drops, the local engine handles the state deterministically, and upon reconnection, the true event ledger synchronizes perfectly.
