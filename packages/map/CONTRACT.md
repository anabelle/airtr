# @acars/map — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Exported Components

```typescript
// Main globe component
function Globe(props: {
  className?: string;
  children?: React.ReactNode;
}): JSX.Element;
```

### Exported Constants

```typescript
// Aircraft family icon map (12 families × 2 layers = 24 icons)
const FAMILY_ICONS: Map<string, { body: string; accent: string }>;

// Supported aircraft families
type AircraftFamilyId =
  | "atr"
  | "dash8"
  | "a220"
  | "ejet"
  | "a320"
  | "b737"
  | "a330"
  | "b787"
  | "b777"
  | "a350"
  | "a380"
  | "b747";
```

### Globe Component Contract

The `Globe` component:

1. Renders a MapLibre GL globe with:
   - Dark style base map
   - 3D terrain
   - Airport markers (6,072 dots)
   - Route arcs (great-circle)
   - Aircraft icons (moving along routes)
   - Day/night terminator overlay

2. Provides imperative control via React context:
   - Camera movement
   - Layer visibility
   - Source updates

3. Supports children as overlay UI (glassmorphic panels)

### Icon System

- 12 aircraft families with unique SVG silhouettes
- Two-layer SDF rendering for livery colors:
  - Body layer: airline primary color
  - Accent layer: airline secondary color
- Icons sourced from tar1090 ADS-B tracker paths

### Contract Rules

1. The `Globe` component API is FROZEN.
2. Icon SVG paths are FROZEN (visual identity).
3. New aircraft families may be added in minor versions.
4. Internal MapLibre layer names may change.
5. Globe CSS class names are NOT part of the contract.

### Dependencies

- `maplibre-gl` — WebGL map rendering
- `react` — React 19+
- `@acars/core` — Types for aircraft, airports
- `@acars/store` — State subscriptions for live updates
