# Map & Simulation Scalability Plan

## Objective
Enable the concurrent rendering and simulation of 10,000 to 100,000+ aircraft instances moving in real-time without degrading UI responsiveness or crashing the browser main thread.

## Current Limitations (MVP Architecture)
- **Main Thread Processing**: All Great Circle math and state updates happen on the JavaScript main thread.
- **GeoJSON Serialization**: Thousands of points are serialized to GeoJSON and sent to the GPU every frame via `setData()`, creating a massive memory and bus bottleneck.
- **React/Zustand Reconciliation**: State updates to large arrays trigger expensive virtual DOM diffing or store subscriber overhead.

---

## Phase A: Custom WebGL/WebGPU Layer (Rendering Scale)
*Moving from CPU-driven positions to GPU-calculated positions.*

### 1. Shader-Based Interpolation
Instead of calculating the current `[lat, lng]` in JavaScript, we pass the "Flight Plan" constants to the GPU in a single vertex buffer.
- **Buffer Data per Aircraft**:
  ```typescript
  [
    Origin_Lng, Origin_Lat, 
    Dest_Lng, Dest_Lat, 
    Departure_Tick, 
    Duration_Ticks, 
    Icon_Type
  ]
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
*Moving the engine logic out of the UI thread.*

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
*Handling global state across Nostr effectively.*

### 1. Vectorized Events
Instead of publishing full fleet states, publish compressed binary events or NIP-XX vector updates.
- Only publish "Flight Dispatched" and "Flight Landed" events.
- Clients reconstruct the movement in between using deterministic math (Epoch Sync).

### 2. Lazy Loading Competitors
Only load and simulate other players' planes that are "nearby" or "on shared routes" to save memory.

---

## Technical Feasibility Log
| Strategy | Difficulty | Impact | Status |
|----------|------------|--------|--------|
| Custom WebGL Layer | High | Rendering Speed | Proposed |
| Web Worker Engine | Medium | UI Stability | Proposed |
| Shader Interpolation | High | Zero CPU Cost | Proposed |
| Spatial Indexing | Medium | Algorithmic Speed | Proposed |
