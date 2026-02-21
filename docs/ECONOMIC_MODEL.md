# AirTR — Economic Model Specification
## Deterministic Engine for Demand, Competition, Revenue, and Costs

This document is the **authoritative specification** for all economic calculations
in `@airtr/core`. Any agent implementing economic functions MUST follow this spec exactly.

---

## 1. Demand Calculation (Gravity Model)

### 1.1 Formula

Base demand between two airports is calculated using a gravity model:

```
Demand(A→B) = K × (Pop_A^α × Pop_B^β × GDP_A^γ × GDP_B^δ) / Distance(A,B)^θ
```

### 1.2 Parameters

| Symbol | Name | Value | Notes |
|--------|------|-------|-------|
| K | Calibration constant | 0.001 | Tuned to produce realistic weekly pax numbers |
| α | Origin population exponent | 0.8 | Sub-linear: doubling pop doesn't double demand |
| β | Destination population exponent | 0.8 | Same as origin |
| γ | Origin GDP-per-capita exponent | 0.6 | Wealth drives travel propensity |
| δ | Destination GDP-per-capita exponent | 0.3 | Destination wealth matters less |
| θ | Distance decay exponent | 1.2 | Further = less demand (super-linear decay) |

### 1.3 Distance Calculation

Great-circle distance using the Haversine formula:

```typescript
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
```

**⚠️ Determinism note**: Use the integer lookup table approach for trig functions
in the final implementation (see ADR-002). The above is the reference formula.

### 1.4 Demand Classes

Total demand is split into three classes:

| Class | Share of Total | Price Elasticity | Booking Window |
|-------|---------------|-----------------|----------------|
| Economy | 75% | -1.5 (high sensitivity) | 14–90 days ahead |
| Business | 20% | -0.5 (low sensitivity) | 1–14 days ahead |
| First | 5% | -0.2 (very low sensitivity) | 1–30 days ahead |

### 1.5 Seasonal Modulation

Demand is multiplied by a seasonal factor based on route type and time of year:

| Route Type | Summer | Winter | Spring/Autumn |
|-----------|--------|--------|---------------|
| Beach/Resort | ×1.30 | ×0.70 | ×1.00 |
| Ski/Mountain | ×0.60 | ×1.40 | ×0.90 |
| Business Hub | ×0.90 | ×1.00 | ×1.10 |
| General | ×1.10 | ×0.90 | ×1.00 |

Route type is inferred from destination airport tags in `@airtr/data`.

### 1.6 Prosperity Index

A global economic multiplier that oscillates over time:

```
prosperityIndex(tick) = 1.0 + 0.15 × sin(2π × tick / TICKS_PER_ECONOMIC_CYCLE)
```

Where `TICKS_PER_ECONOMIC_CYCLE` = 365 (one in-game year).
Range: 0.85 (recession) to 1.15 (boom).

---

## 2. Quality Service Index (QSI)

### 2.1 Purpose

When multiple airlines serve the same O&D pair, the QSI determines what
fraction of total demand each airline captures.

### 2.2 Formula

```
QSI_i = (w_price × PriceScore_i) + 
        (w_freq × FrequencyScore_i) + 
        (w_time × TravelTimeScore_i) + 
        (w_stops × StopsScore_i) + 
        (w_service × ServiceScore_i) + 
        (w_brand × BrandScore_i)
```

### 2.3 Weights by Passenger Class

| Factor | Economy Weight | Business Weight | First Weight |
|--------|---------------|----------------|--------------|
| Price (w_price) | 0.40 | 0.15 | 0.05 |
| Frequency (w_freq) | 0.15 | 0.30 | 0.20 |
| Travel Time (w_time) | 0.15 | 0.20 | 0.15 |
| Stops (w_stops) | 0.10 | 0.15 | 0.20 |
| Service (w_service) | 0.10 | 0.10 | 0.25 |
| Brand (w_brand) | 0.10 | 0.10 | 0.15 |
| **Total** | **1.00** | **1.00** | **1.00** |

### 2.4 Score Calculations

**PriceScore**: Inverse normalized. Cheapest airline gets 1.0, most expensive gets 0.0.
```
PriceScore_i = 1 - (price_i - min_price) / (max_price - min_price + 1)
```

**FrequencyScore**: Normalized by total frequency.
```
FrequencyScore_i = flights_per_week_i / sum(flights_per_week_all)
```

**TravelTimeScore**: Inverse normalized (shortest time = best).
```
TravelTimeScore_i = 1 - (time_i - min_time) / (max_time - min_time + 1)
```

**StopsScore**: Nonstop = 1.0, 1 stop = 0.5, 2+ stops = 0.2.

**ServiceScore**: Based on aircraft age, cabin configuration, and amenities (0.0–1.0).

**BrandScore**: The airline's reputation (0.0–1.0), evolved over time.

### 2.5 Market Share

```
MarketShare_i = QSI_i / sum(QSI_all)
PassengersAllocated_i = MarketShare_i × TotalDemand
```

---

## 3. Revenue Calculation

```
TicketRevenue = PassengersAllocated × AverageTicketPrice
AncillaryRevenue = PassengersAllocated × AncillaryPerPax

TotalRevenue = TicketRevenue + AncillaryRevenue
```

### 3.1 Load Factor

```
LoadFactor = min(1.0, PassengersAllocated / SeatsOffered)
ActualPassengers = SeatsOffered × LoadFactor
```

If PassengersAllocated > SeatsOffered, excess demand is **spilled**
(goes to competitors or is lost).

---

## 4. Cost Model

### 4.1 Cost Components

All costs are per-flight and summed across all flights per tick.

| Component | Formula | Notes |
|-----------|---------|-------|
| **Fuel** | `distance_km × fuel_per_km × fuel_price` | fuel_per_km depends on aircraft type |
| **Crew** | `block_hours × crew_cost_per_hour × crew_count` | crew_count depends on aircraft type |
| **Maintenance** | `block_hours × maint_per_hour` | Increases with aircraft age |
| **Airport Fees** | `landing_fee + terminal_fee + pax_fee × passengers` | Per airport, varies by airport size |
| **Navigation** | `distance_km × nav_fee_per_km` | Overflight charges |
| **Leasing** | `monthly_lease / flights_per_month` | Amortized per flight |
| **Insurance** | `annual_insurance / flights_per_year` | Amortized per flight |
| **Overhead** | `5% × (sum of above)` | Administration, marketing, etc. |

### 4.2 Reference Aircraft Data (examples)

| Type | Seats | Range (km) | Fuel/km (kg) | Crew | Lease ($/mo) | Maint ($/hr) |
|------|-------|-----------|-------------|------|-------------|-------------|
| ATR 72-600 | 70 | 1,528 | 1.8 | 4 | 120,000 | 450 |
| A320neo | 180 | 6,300 | 2.5 | 6 | 380,000 | 850 |
| B737-800 | 189 | 5,765 | 2.6 | 6 | 350,000 | 800 |
| A330-300 | 300 | 11,750 | 5.8 | 10 | 800,000 | 1,800 |
| B787-9 | 290 | 14,140 | 5.0 | 10 | 950,000 | 1,600 |
| A380-800 | 525 | 15,200 | 11.0 | 18 | 1,500,000 | 3,500 |

---

## 5. Profit/Loss

```
Profit = TotalRevenue - TotalCosts
Balance(tick) = Balance(tick-1) + Profit(tick)
```

### 5.1 Bankruptcy

If `Balance < -1,000,000` (negative $1M) for 30 consecutive ticks:
- Player enters "restructuring" mode
- Must sell aircraft or close routes to reduce costs
- If balance reaches `-5,000,000`: game over (but can restart)

---

## 6. Dynamic Effects

### 6.1 Price War Detection

If any airline prices more than 30% below the route average:
- Total demand on the route increases by 10% (price stimulation)
- All airlines' margins decrease proportionally
- Brand scores for underpricing airlines decrease by 0.01 per tick

### 6.2 Market Saturation

If total seats offered on a route exceed demand by more than 150%:
- All airlines on the route receive a load factor penalty of -5%
- This simulates excess capacity depressing the market

### 6.3 Brand Score Evolution

```
BrandScore(tick+1) = BrandScore(tick) + Δ
```

| Event | Δ (change per tick) |
|-------|-------------------|
| Load factor > 85% | +0.002 |
| Load factor < 50% | -0.003 |
| On-time performance > 95% | +0.001 |
| Flight cancellation | -0.010 |
| Serving > 20 routes | +0.001 |
| Tier upgrade | +0.050 (one-time) |

Brand score is clamped to [0.0, 1.0].

---

## 7. Anti-Cheat Properties

All of the above calculations are:
1. **Deterministic**: Same inputs → same outputs. No randomness except seeded PRNG.
2. **Transparent**: All formulas are open-source and visible to all players.
3. **Verifiable**: Any client can replay the event log and verify the state hash.
4. **Computed, not stored**: Balances are derived, not stored. You can't "edit" your balance.

---

## 8. Implementation Notes

- All financial values use **fixed-point arithmetic** (4 decimal places, integer internally).
  See ADR-002.
- All random values use the **seeded PRNG** (`prng.ts`), seeded by tick number.
- Distance calculations use the **integer lookup table** for trig functions.
- The tick processor processes ALL airlines simultaneously per tick.
- Sort order in loops MUST be deterministic (sort by airline pubkey, then by route IATA pair).
