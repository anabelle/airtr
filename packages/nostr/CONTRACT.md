# @acars/nostr — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Exported Types

```typescript
import { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";

interface ActionEnvelope {
  schemaVersion: number;
  action: GameActionType;
  payload: Record<string, unknown>;
}

interface ActionLogEntry {
  event: NDKEvent;
  action: ActionEnvelope;
  pubkey: string;
  createdAt: number;
}

interface MarketplaceListing {
  eventId: string;
  pubkey: string;
  aircraftId: string;
  modelId: string;
  askingPrice: FixedPoint;
  createdAt: number;
}

interface SellerFleetIndex {
  sellerPubkey: string;
  listings: MarketplaceListing[];
}
```

### Exported Constants

```typescript
const MARKETPLACE_KIND = 30079;
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
function waitForNip07(): Promise<void>;
function getPubkey(): string | null;
function loginWithNsec(nsec: string): Promise<void>;
function attachSigner(event: NDKEvent): Promise<void>;

// Action Log (kind 30078)
function loadActionLog(pubkey: string): Promise<ActionLogEntry[]>;
function publishAction(envelope: ActionEnvelope): Promise<void>;
function subscribeActions(options: {
  since: number;
  onEvent: (entry: ActionLogEntry) => void;
  onClose?: () => void;
}): Promise<() => void>;

// Checkpoints
function loadCheckpoint(
  pubkey: string,
  tick: number,
): Promise<Checkpoint | null>;
function loadCheckpoints(pubkey: string): Promise<Checkpoint[]>;
function publishCheckpoint(checkpoint: Checkpoint): Promise<void>;

// Marketplace (kind 30079)
function loadMarketplace(): Promise<SellerFleetIndex[]>;
function publishUsedAircraft(listing: {
  aircraftId: string;
  askingPrice: FixedPoint;
}): Promise<void>;
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
- `@acars/core` — Uses FixedPoint, Checkpoint, GameActionType types
