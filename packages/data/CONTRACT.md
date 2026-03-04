# @acars/data — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Exported Types

```typescript
import type { Airport, HubTier } from "@acars/core";

interface HubClassification {
  iata: string;
  tier: HubTier;
  baseCapacityPerHour: number;
  slotControlled: boolean;
  baseLandingFee: number;
}

interface HubPricing {
  openFee: number; // Raw number — wrap with fp() before financial calculations
  monthlyOpex: number; // Raw number — wrap with fp() before financial calculations
  tier: HubTier;
}
```

### Exported Constants

```typescript
// Airport catalog (6,072 airports from OpenFlights)
const airports: Airport[];

// Aircraft catalog (15 models across 4 tiers)
const aircraftModels: AircraftModel[];

// Aircraft indexes
const aircraftByFamilyId: Map<string, AircraftModel[]>;
const aircraftByTier: Map<number, AircraftModel[]>;

// Hub classifications for major airports
const HUB_CLASSIFICATIONS: Record<string, HubClassification>;

// Hub tier pricing
const HUB_TIER_PRICING: Record<
  HubTier,
  { openFee: number; monthlyOpex: number }
>;
```

### Exported Functions

```typescript
// Aircraft lookup
function getAircraftById(id: string): AircraftModel | undefined;
function getAircraftByType(type: AircraftModel["type"]): AircraftModel[];

// Hub utilities
function getHubPricingForIata(iata: string): HubPricing;

// Geography utilities
function findPreferredHub(
  lat: number,
  lon: number,
  airports?: Airport[],
): Airport;
```

### Contract Rules

1. All exports listed above are FROZEN until a major version bump.
2. The `airports` array is immutable — do not modify.
3. The `aircraftModels` array is immutable — do not modify.
4. New airports may be added in minor versions (data corrections).
5. New aircraft models may be added in minor versions.
6. Hub classifications may be updated in minor versions (real-world changes).

### Dependencies

- `@acars/core` — Re-exports Airport, AircraftModel, HubTier types
