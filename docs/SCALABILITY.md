# Map & Simulation Scalability Plan

## Objective

Enable the concurrent rendering and simulation of 10,000 to 100,000+ aircraft instances moving in real-time without degrading UI responsiveness or crashing the browser main thread.

## Current Limitations (MVP Architecture)

- **Main Thread Processing**: All Great Circle math and state updates happen on the JavaScript main thread.
- **GeoJSON Serialization**: Thousands of points are serialized to GeoJSON and sent to the GPU every frame via `setData()`, creating a massive memory and bus bottleneck.
- **React/Zustand Reconciliation**: State updates to large arrays trigger expensive virtual DOM diffing or store subscriber overhead.

---

## Phase 0: Algorithmic Optimizations (Implemented)

_Eliminating the worst CPU-side bottlenecks within the existing MapLibre layer architecture._

### 1. O(1) Airport Lookups

Planned: replace `airports.find(a => a.iata === ...)` linear scans with a `Map<string, Airport>` index built via `useMemo`. At 10K routes with ~4 lookups each, this eliminates ~240M string comparisons per update cycle.

### 2. Viewport Culling

Both arc geometry computation and aircraft position updates now skip entities outside the current map viewport. Uses AABB overlap tests with generous great-circle curvature margins. At typical zoom levels, this eliminates 70-90% of geometry computation.

### 3. Zoom-Adaptive LOD (Level of Detail)

Arc segment count scales with zoom level: 8 segments at z<2, up to 50 at z>8. At low zoom (world view), this reduces coordinate count by ~85% with no visible quality difference. Cache is invalidated when LOD tier changes.

### 4. Arc Geometry Memoization

Computed arc coordinates are cached in a `Map<string, [number, number][]>` keyed by `origin-dest-segments`. Global route arcs (which rarely change) are computed once and reused across frames. Cache invalidates automatically on LOD tier changes.

### 5. requestAnimationFrame Flight Animation

Aircraft position interpolation now runs via `requestAnimationFrame` instead of `setInterval(..., 1000)`, providing smooth 60fps movement. Uses React refs to avoid stale closures without re-registering the RAF loop on every state change.

### 6. Debounced Viewport Updates

Arc re-computation on pan/zoom is debounced at 150ms to avoid thrashing during continuous map interaction.

### 7. Two-Layer SDF Livery Rendering (Family-Specific Icons)

Aircraft icons use MapLibre's SDF (Signed Distance Field) icon rendering to display per-airline livery colors without generating unique bitmaps per airline. Each aircraft **family** (12 families: ATR, Dash8, A220, E-Jet, A320, B737, A330, B787, B777, A350, A380, B747) has two distinct SVG icons sourced from tar1090 ADS-B tracker paths:

- **Body layer**: the airplane silhouette, tinted with the airline's `primary` livery color via `icon-color`.
- **Accent layer**: detail shapes (engine rings, wing stripes, tail details) overlaid at the same position/rotation, tinted with the airline's `secondary` livery color.

Icon selection uses a 12-way `match` expression on each feature's `familyId` property (e.g., `["match", ["get", "familyId"], "atr", "airplane-atr", "b747", "airplane-b747", ...]`). All 24 icons (12 body + 12 accent) are registered once at map init via the `FAMILY_ICONS` map exported from `packages/map/src/icons.ts`.

Both layers read `primaryColor` and `secondaryColor` from GeoJSON feature properties, falling back to neutral defaults when no livery is set. This scales to unlimited airlines with zero icon atlas regeneration — only two draw calls per fleet source (player + global), regardless of how many distinct liveries are visible.

### 8. Zoom-Based Icon Size Interpolation

Aircraft icon size scales with zoom level to prevent visual clutter at low zoom. Each feature carries a `sizeScale` property computed from the aircraft's real-world wingspan (`wingspanM / 35.8 * baseSize`), which is then multiplied by a zoom-dependent factor:

| Zoom Level | Scale Multiplier | Typical View |
| ---------- | ---------------- | ------------ |
| 2          | 0.15x            | Globe        |
| 5          | 0.40x            | Continent    |
| 8          | 0.70x            | Regional     |
| 12         | 1.00x            | City         |

This uses MapLibre's `["interpolate", ["linear"], ["zoom"], ...]` expression with embedded `["*", ["get", "sizeScale"], factor]` at each stop, so both zoom level and per-aircraft wingspan affect the final rendered size.

### 9. React StrictMode WebGL Compatibility

React 19 StrictMode double-mounts components in dev (Mount → Unmount → Re-mount). Map cleanup is deferred via `setTimeout(100ms)` so that StrictMode's immediate re-mount can cancel the pending `map.remove()` and reuse the still-alive WebGL context. This prevents "WebGL context was lost" crashes during development.

### 10. Tiered Airport Classification (Map Readability)

Airports are classified client-side into a small set of visual tiers to improve map readability at a glance:

- **Active hub** (player's primary hub): pulsing green glow + largest radius
- **Player hub** (other owned hubs): green, slightly smaller
- **Route destination** (active routes touching player hubs): amber highlight
- **Competitor hub**: tinted with competitor airline primary livery color (fallback orange)
- **Major airport**: based on `HUB_CLASSIFICATIONS` tier (`global`/`international`) or population >= 5M
- **Default**: muted slate

This classification is attached as `airportClass` and optional `competitorHubColor` properties in the airport GeoJSON source and rendered via data-driven MapLibre circle paint expressions. The approach keeps the airports layer lightweight while providing immediate visual hierarchy.

---

## Phase A: Custom WebGL/WebGPU Layer (Rendering Scale)

_Moving from CPU-driven positions to GPU-calculated positions._

### 1. Shader-Based Interpolation

Instead of calculating the current `[lat, lng]` in JavaScript, we pass the "Flight Plan" constants to the GPU in a single vertex buffer.

- **Buffer Data per Aircraft**:
  ```typescript
  [
    Origin_Lng,
    Origin_Lat,
    Dest_Lng,
    Dest_Lat,
    Departure_Tick,
    Duration_Ticks,
    Icon_Type,
  ];
  ```
- **Vertex Shader Logic**:
  - Receive `u_current_tick` as a global uniform.
  - Calculate `progress = (u_current_tick - Departure_Tick) / Duration_Ticks`.
  - Perform **SLERP (Spherical Linear Interpolation)** directly in the shader.
  - Calculate bearing by looking at `progress + epsilon`.
- **Result**: Zero CPU work for movement. 100k planes move as cheaply as 1.

### 2. Instanced Rendering

Use `gl.drawArraysInstanced` to draw all aircraft icons in a single draw call.

- Use a single icon atlas (SDF-based for sharp icons at any zoom).
- GPU handles the transform/rotation/offset per instance.

---

## Phase B: Off-Main-Thread Simulation (Logic Scale)

_Moving the engine logic out of the UI thread._

### 1. Web Worker Engine

Move the `processTick` and financial engine into a dedicated **Web Worker**.

- UI thread only handles rendering and user input.
- Worker processes aircraft state transitions and emits "delta" events.
- Communications via `SharedArrayBuffer` for zero-copy state sharing (requires strict COOP/COEP headers).

### 2. Spatial Indexing

Use a library like `rbush` or a customized Quadtree to optimize spatial queries.

- Only calculate detail for aircraft within the current camera frustum.
- Optimize "Conflict Detection" or "Airport Congestion" logic using 2D spatial queries.

---

## Phase C: Data Synchronization (Multiplayer Scale)

_Handling global state across Nostr effectively._

## Phase C: Data Synchronization (Multiplayer Scale)

_Handling global state across Nostr effectively._

### 1. NIP-33 Snapshot Rollups (Implemented)

Instead of fetching the entire event history, clients fetch the latest **Snapshot Rollup** via NIP-33.

- **Compression**: Payloads are Gzip-compressed, reducing relay storage by 90%.
- **Attestation**: Every snapshot includes a state hash and action chain hash for verification.
- **Latency**: Reduces join time from $O(N)$ (events) to $O(1)$ (latest snapshot).

### 2. Multi-Layer Local Persistence (Implemented)

Local state is persisted to **IndexedDB (Dexie)** for instant app resumption without waiting for a relay round-trip. The data is synchronized in the background with Nostr snapshots to ensure accuracy across devices.

### 3. Background Auditor (Implemented)

State integrity is verified in a dedicated Web Worker to detect and correct any deterministic drift or memory corruption without blocking the UI thread.

---

## Technical Feasibility Log

| Strategy                           | Difficulty | Impact            | Status          |
| ---------------------------------- | ---------- | ----------------- | --------------- |
| O(1) Airport Index                 | Low        | Algorithmic Speed | **Planned**     |
| Viewport Culling                   | Low        | Rendering Speed   | **Implemented** |
| Zoom-Adaptive LOD                  | Low        | Rendering Speed   | **Implemented** |
| Arc Memoization                    | Low        | CPU Reduction     | **Implemented** |
| RAF Flight Animation               | Low        | Visual Quality    | **Implemented** |
| Two-Layer SDF Livery (12 families) | Low        | Visual Identity   | **Implemented** |
| Zoom-Based Icon Sizing             | Low        | Map Readability   | **Implemented** |
| StrictMode WebGL Fix               | Low        | Dev Stability     | **Implemented** |
| Tiered Airport Classes             | Low        | Map Readability   | **Implemented** |
| **NIP-33 Snapshot Rollups**        | Medium     | Join Latency      | **Implemented** |
| **IndexedDB Persistence**          | Low        | Startup Speed     | **Implemented** |
| **Background Auditor**             | Medium     | Data Integrity    | **Implemented** |
| Custom WebGL Layer                 | High       | Rendering Speed   | Proposed        |
| Web Worker Engine                  | Medium     | UI Stability      | Proposed        |
| Shader Interpolation               | High       | Zero CPU Cost     | Proposed        |
| Spatial Indexing                   | Medium     | Algorithmic Speed | Proposed        |
