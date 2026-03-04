# @acars/nostr — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Exported Types

```typescript
import type { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import type {
  GameActionEnvelope,
  Checkpoint,
  FixedPoint,
  AircraftInstance,
} from "@acars/core";

// Re-exported from @acars/core
export type { GameActionEnvelope, Checkpoint, FixedPoint, AircraftInstance };

// Action Log
export interface ActionLogEntry {
  event: NDKEvent;
  action: GameActionEnvelope;
}

// Marketplace
export interface MarketplaceListing {
  id: string; // Nostr event ID
  instanceId: string; // Original aircraft instance ID
  sellerPubkey: string; // Seller's Nostr pubkey
  createdAt: number; // Event creation timestamp
  modelId: string; // Aircraft model ID
  name: string; // Aircraft display name
  ownerPubkey: string; // Owner pubkey (from content)
  marketplacePrice: FixedPoint; // Asking price
  listedAt: number; // When listing was created
  condition: number; // Aircraft condition 0.0-1.0
  flightHoursTotal: number; // Total flight hours
  flightHoursSinceCheck: number; // Flight hours since last check
  birthTick: number; // Tick when aircraft was manufactured
  purchasedAtTick: number; // Tick when current owner purchased
  purchasePrice: FixedPoint; // Original purchase price
  baseAirportIata: string; // Base airport
  purchaseType: "buy" | "lease";
  configuration: {
    economy: number;
    business: number;
    first: number;
    cargoKg: number;
  };
}

// Index for ownership verification
export type SellerFleetIndex = Map<string, Set<string>>; // pubkey -> Set<instanceId>
```

### Exported Constants

```typescript
const MARKETPLACE_KIND = 30079; // NDKKind for used aircraft listings
```

### Exported Functions

```typescript
// NDK Connection Management
function getNDK(): NDK;
function ensureConnected(): Promise<void>;
function connectedRelayCount(): number;
function reconnectIfNeeded(): Promise<boolean>;

// Identity
function hasNip07(): boolean;
function waitForNip07(timeoutMs?: number): Promise<boolean>;
function getPubkey(timeoutMs?: number): Promise<string | null>;
function loginWithNsec(nsec: string): Promise<string>; // Returns hex pubkey
function attachSigner(): void; // Synchronous, attaches NIP-07 signer to NDK

// Action Log (kind 30078)
// Note: Events with future schemaVersion values are accepted with clamping to
// the max supported version. Older schemaVersion values are accepted for
// backward compatibility.
function loadActionLog(options?: {
  authors?: string[];
  limit?: number;
  maxPages?: number;
  since?: number;
}): Promise<ActionLogEntry[]>;
function publishAction(
  action: GameActionEnvelope,
  seq?: number,
): Promise<NDKEvent>;
function subscribeActions(options: {
  onEvent: (entry: ActionLogEntry) => void;
  authors?: string[];
  since?: number;
  onEose?: () => void;
  onClose?: () => void;
}): Promise<() => void>;

// D-Tags (for event addressing)
function buildActionDTag(action: GameActionEnvelope, seq?: number): string;

// Checkpoints
function loadCheckpoint(pubkey: string): Promise<Checkpoint | null>;
function loadCheckpoints(pubkeys: string[]): Promise<Map<string, Checkpoint>>;
function publishCheckpoint(checkpoint: Checkpoint): Promise<NDKEvent>;

// Marketplace (kind 30079)
function loadMarketplace(
  sellerFleets?: SellerFleetIndex,
): Promise<MarketplaceListing[]>;
function publishUsedAircraft(
  aircraft: AircraftInstance,
  price: FixedPoint,
): Promise<NDKEvent>;

// Deprecated (throw errors)
function publishAirline(): Promise<never>;
function loadAirline(): Promise<never>;
function loadGlobalAirlines(): Promise<never>;
```

### Re-exports

```typescript
// NDK types for downstream consumers
export { NDKEvent } from "@nostr-dev-kit/ndk";
export type { NDKFilter } from "@nostr-dev-kit/ndk";
```

### Contract Rules

1. All exports listed above are FROZEN until a major version bump.
2. Event kinds (30078, 30079) are part of the contract.
3. Action envelope schema version must be incremented on breaking changes.
4. Relay URLs are NOT part of the contract (configurable).

### Dependencies

- `@nostr-dev-kit/ndk` — Nostr Development Kit
- `@acars/core` — Uses FixedPoint, Checkpoint, GameActionEnvelope, AircraftInstance types
