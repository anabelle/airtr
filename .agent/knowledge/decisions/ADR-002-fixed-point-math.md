# ADR-002: Use Fixed-Point Arithmetic for Economic Calculations

## Status: ACCEPTED
## Date: 2026-02-20

## Context
The game simulation must be deterministic across all clients.
IEEE 754 floating-point arithmetic produces different results on
different hardware, compilers, and optimization levels. This would
cause state divergence between clients, breaking the decentralized
simulation model.

## Decision
All financial and economic calculations in `@airtr/core` will use
fixed-point arithmetic with 4 decimal places of precision.
We use integer math internally, dividing by 10000 only for display.

```typescript
// $123.45 is stored as:
const amount = 1234500; // integer (4 decimal fixed-point)

// Multiplication: $123.45 × 1.15 (15% markup)
const markup = 11500; // 1.15 in fixed-point
const result = (amount * markup) / 10000; // = 1419675 = $141.9675
```

## Consequences
- ✅ Perfect determinism across all platforms
- ✅ No rounding surprises in financial calculations
- ✅ Integer arithmetic is faster than floating-point
- ⚠️ Slightly more complex arithmetic code
- ⚠️ Must be careful about integer overflow with large values
- ⚠️ Division truncates rather than rounds — use explicit rounding where needed
- 🚫 No agent may use bare `number` for financial values in `@airtr/core`
- 🚫 No agent may use `Math.random()` in `@airtr/core` — use seeded PRNG
