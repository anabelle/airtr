# ADR-001: Use CesiumJS for 3D Globe View

## Status: ACCEPTED
## Date: 2026-02-20

## Context
The game requires a 3D globe visualization with terrain, aircraft models,
follow cameras, and cockpit views — similar to Flightradar24's 3D mode.

Three options were evaluated:
1. **CesiumJS** — Purpose-built for 3D geospatial, used by FR24
2. **Three.js** — General 3D library, no native geospatial support
3. **MapLibre GL JS** — 2D/2.5D map, new globe projection support

## Decision
Use CesiumJS for the 3D view, lazy-loaded only when the user opts in.
Use MapLibre GL JS for the primary 2D/2.5D map view.

## Rationale
- CesiumJS is what Flightradar24 actually uses
- Native support for 3D Tiles, terrain, glTF models
- Time-dynamic entities (aircraft moving along paths)
- FR24's open-source 3D aircraft models are in glTF (CesiumJS-native)
- ~4MB library cost is acceptable when lazy-loaded

## Consequences
- ✅ Fastest path to FR24-quality 3D visualization
- ✅ MapLibre handles the lightweight primary view
- ✅ CesiumJS only loads when user clicks "3D View"
- ⚠️ CesiumJS is large; must be code-split and lazy-loaded
- ⚠️ CesiumJS requires a Cesium Ion token for some features (terrain tiles)
- 🚫 Do NOT use CesiumJS for the primary 2D map view
