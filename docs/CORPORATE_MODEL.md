# AirTR — Advanced Corporate & Financial Model
## Stocks, Mergers, Bankruptcy, and the Decoupling of Player and Corporation

As AirTR scales to millions of users, the traditional "One Player = One Airline" model becomes overly restrictive. To simulate a true, dynamic global economy with corporate drama, we must separate the **Player** from the **Airline**.

This document outlines the architecture for Phase 9 of the roadmap: The Corporate Era.

---

## 1. The Core Architecture: Decoupling

In the MVP, an Airline's ID was simply the player's Nostr Pubkey. 
In the robust model, an **Airline is a distinct cryptographic entity** (its ID is the hash of its `genesis` event). A **Player** is an investor, board member, or CEO.

### 1.1 The Player (Nostr Pubkey)
A Player interacts with the game with their wallet and identity. They possess:
- A portfolio of **Shares** in various airline entities.
- A **Reputation Score** (as CEO or Board Member).
- Personal **Fiat/Sats Balance** (distinct from an airline's corporate treasury).

### 1.2 The Airline (The Corporation)
An Airline is a financial entity with a balance sheet. It possesses:
- **Assets**: Aircraft, Airport Slots, Cash.
- **Liabilities**: Debt, Pending M&A obligations.
- **Cap Table**: 10,000,000 issued shares, distributed among Player pubkeys.
- **The CEO**: A pointer to the Player pubkey currently authorized to make operational decisions (buy planes, set routes).

---

## 2. Public Markets & Stocks

Airlines do not start public. At Tier 1 and Tier 2, the founding Player owns 100% of the private shares and is the dictator of the company. 

### 2.1 The IPO (Initial Public Offering)
When an airline reaches **Tier 3 (Intercontinental)**, the CEO can trigger an IPO event:
1. The company lists on the global AirTR stock exchange.
2. A percentage of shares (e.g., 40%) is floated to the public market.
3. Other players can buy these shares using their personal cash.
4. The Airline's corporate treasury receives a massive cash injection to fund widebody expansion.

### 2.2 Quarterly Dividends
Profitable public airlines can issue dividends. Every in-game Quarter (1 real-world week), the CEO can declare a dividend (e.g., $0.10 per share). The cash leaves the corporate treasury and enters the personal wallets of the shareholders proportional to their holdings.

### 2.3 The Hostile Takeover / Board Votes
If a CEO drives a public airline into the ground (burning cash, failing routes), the shareholders can revolt.
- If a coalition of players acquires > 50% of the active shares, they can publish a **Vote Event** (`kind: 30081`).
- The smart-engine evaluates the signatures. If >50% of shares vote to oust the CEO, a new Pubkey is appointed. The founder is officially fired from their own company.

---

## 3. Mergers & Acquisitions (M&A)

A vibrant economy requires consolidation.

### 3.1 Holding Companies (Air France-KLM Model)
If Player A (CEO of SkyNova) buys 51% of the shares of Oceanic Air:
- SkyNova becomes a holding company.
- Both airlines continue to operate under their own distinct branding and separate fleets.
- However, they now share **Network Synergies**: Passengers can seamlessly route through both airlines' hubs without QSI penalties, and they share terminal fees.

### 3.2 Full Mergers
A complete merger integrates the two entities:
- **Event sequence**: A "Merger Agreement" is proposed and signed by both boards.
- The target airline is dissolved. Its routes, slots, and aircraft are transferred to the acquiring airline's ID.
- The target's shareholders receive shares in the new mega-carrier.

---

## 4. Bankruptcy & Insolvency

Airlines run on razor-thin margins. Bad fuel hedging, sudden demand shocks, or over-expansion will inevitably lead to ruin.

### 4.1 Chapter 11 (Restructuring)
If an Airline's balance drops below a critical debt threshold for 7 consecutive days:
- The backend automatically transitions the entity status to `chapter11`.
- **Protections**: The airline is protected from immediate liquidation. Creditors cannot seize assets.
- **Restrictions**: The CEO's controls are severely limited. They cannot buy new aircraft or issue dividends. They must renegotiate leases, sell off unprofitable routes, and shrink the fleet to return to profitability.

### 4.2 Chapter 7 (Liquidation)
If restructuring fails (balance remains fatally negative after 14 days):
- The entity status becomes `liquidated`.
- The airline ceases all operations instantly. All routes are zeroed out.
- The fleet is forcefully auctioned off to the highest bidder on the Nostr Market.
- The shares drop to $0.00. Investors lose their capital. The brand is dead.

---

## 5. Summary of the Data Contract

To support this, the core schema transitions from a simple object into a distributed ledger representation:

```typescript
export interface AirlineEntity {
    id: string;               // Hash of genesis event
    foundedBy: string;        // Founder's pubkey
    status: 'private' | 'public' | 'chapter11' | 'liquidated';
    
    // Leadership & Ownership
    ceoPubkey: string;        // Current operator
    sharesOutstanding: number;
    shareholders: Record<string, number>; // pubkey -> share count
    
    // Core Identity
    name: string;
    icaoCode: string;
    hubs: string[];           // Array of IATA codes
    
    // Financials
    corporateBalance: FixedPoint;
    stockPrice: FixedPoint;   // Derived purely from earnings & market cap
    
    // Assets (References)
    fleetIds: string[];
    routeIds: string[];
}
```

This model is infinitely scalable because it relies entirely on decentralized Nostr events (Votes, Trades, M&A Signatures) verified strictly by the client-side deterministic engine. It enables true Wall Street-style gameplay for players who want to act as investors rather than pilots.
