// @acars/core — Route utilities
// ============================================================

export function canonicalRouteKey(originIata: string, destinationIata: string): string {
  return originIata < destinationIata
    ? `${originIata}-${destinationIata}`
    : `${destinationIata}-${originIata}`;
}
