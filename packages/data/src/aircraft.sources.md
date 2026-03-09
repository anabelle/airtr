# Aircraft Catalog Source Notes

This catalog uses a split sourcing policy:

- Physical specifications (`wingspanM`, `rangeKm`, `speedKmh`, `maxTakeoffWeight`, engine count) are based on OEM published specifications and certification data when available.
- Cabin layouts reflect representative in-service passenger configurations rather than maximum certified seating.
- Economics (`price`, `monthlyLease`, `casm`, `maintCostPerHour`, utilization and turnaround assumptions) are benchmarked estimates normalized for gameplay consistency against the rest of the catalog.

## Primary reference families

- Airbus commercial aircraft product pages and airport / aircraft characteristics documents
- Boeing commercial airplanes technical characteristics summaries
- Embraer commercial aviation aircraft pages and E-Jet family overviews
- ATR and De Havilland Canada published aircraft specifications
- FAA and EASA type-certificate data sheets where applicable

## Benchmark reference classes

- Airline investor disclosures and fleet planning documents for typical layouts
- Lessor and market commentary for monthly lease and residual value ranges
- Industry benchmark material such as IATA / airline annual-report operating-cost context

## Confidence notes

- Highest confidence: dimensions, engine count, cruise speed class, certified or advertised range class
- Medium confidence: representative cabin layouts and cargo assumptions
- Lower confidence: lease, maintenance, and CASM values, which are intentionally calibrated estimates rather than claims of exact market pricing

## Wave 1 additions

- `atr42-600`, `dash8-300`
- `a220-100`, `e175`, `e195-e2`
- `a320-200`, `a321lr`
- `a330-200`, `b787-8`, `b777-200er`
- `a350-1000`

## Wave 2 additions

- `e170`, `e190`
- `a319neo`, `a321xlr`
- `b737-700`, `b737-900er`, `b737-max9`
- `b787-10`, `b777-200lr`

If we continue with legacy or niche manufacturers later, they should go into a separate expansion pass with dedicated family-level source notes and, where needed, new map icon support.
