# ACARS — Implementation Roadmap

## From Empty Repo to World Simulation

---

## Phase 0: Foundation (Infrastructure)

**Goal**: A buildable monorepo with zero features but all tooling working.
**Definition of Done**: `pnpm install && pnpm build && pnpm test` passes.

| ID    | Task                                                              | Zone  | Dependencies |
| ----- | ----------------------------------------------------------------- | ----- | ------------ |
| T-001 | Initialize pnpm monorepo with workspace config                    | infra | —            |
| T-002 | Create `@acars/core` package skeleton (tsconfig, vitest, exports) | core  | T-001        |
| T-003 | Create `@acars/data` package skeleton                             | data  | T-001        |
| T-004 | Create `@acars/nostr` package skeleton                            | nostr | T-001        |
| T-005 | Create `@acars/store` package skeleton (Zustand)                  | store | T-001        |
| T-007 | Create `@acars/map` package skeleton (MapLibre GL)                | map   | T-001        |
| T-010 | Create `apps/web` Vite+React application                          | app   | T-001        |
| T-011 | Set up ESLint, Prettier, TypeScript strict config (shared)        | infra | T-001        |
| T-012 | Set up GitHub Actions CI (gates pipeline)                         | infra | T-011        |
| T-013 | Write CONTRACT.md for `@acars/core`                               | core  | T-002        |
| T-014 | Write CONTRACT.md for `@acars/data`                               | data  | T-003        |

> **Note**: Tasks T-006 (`@acars/ui`), T-008 (`@acars/i18n`), and T-009 (`@acars/audio`) from the original plan have been deferred. These packages will be created in later phases as needed.

**Estimated effort**: 11 tasks, ~2 days with 2 agents

---

## Phase 1: Static World (Data + Display)

**Goal**: A globe showing real airports. No game logic yet.
**Definition of Done**: Open the app, see a MapLibre globe with 6,072 airports as dots. Click an airport, see its info panel.

| ID    | Task                                                          | Zone  | Dependencies |
| ----- | ------------------------------------------------------------- | ----- | ------------ |
| T-020 | Import OpenFlights airport data into `@acars/data`            | data  | T-003        |
| T-021 | Define Airport, Country, AircraftType TypeScript types        | core  | T-013        |
| T-022 | Import aircraft type catalog into `@acars/data`               | data  | T-021        |
| T-023 | MapLibre GL basic globe setup (dark style, 3D terrain)        | map   | T-007        |
| T-024 | Airport marker layer on MapLibre (6,072 dots)                 | map   | T-020, T-023 |
| T-025 | Airport info panel component (name, IATA, location, timezone) | ui    | T-006, T-021 |
| T-026 | Click-airport-to-select interaction                           | map   | T-024, T-025 |
| T-027 | Zustand map store (camera position, selected airport)         | store | T-005, T-023 |
| T-028 | Basic app layout (fullscreen map, side panel, top bar)        | app   | T-010, T-023 |
| T-029 | i18n setup with English base translations                     | i18n  | T-008        |
| T-030 | Dark mode design system (CSS custom properties, typography)   | ui    | T-006        |
| T-031 | Airport search/filter by name or IATA code                    | ui    | T-020, T-025 |

**Estimated effort**: 12 tasks, ~2 days with 3 agents

---

## Phase 2: Airline Identity (Nostr + Personalization)

**Goal**: A player can create their airline and it persists on Nostr.
**Definition of Done**: Generate Nostr keys, name your airline, pick colors, choose a hub. Reload the page and your airline is still there.

| ID    | Task                                                       | Zone  | Dependencies |
| ----- | ---------------------------------------------------------- | ----- | ------------ |
| T-040 | NDK setup and relay connection                             | nostr | T-004        |
| T-041 | Nostr key generation / NIP-07 browser extension import     | nostr | T-040        |
| T-042 | Airline creation event schema (kind 30078)                 | nostr | T-040        |
| T-043 | Airline creation wizard UI (name, colors, hub picker)      | ui    | T-025, T-030 |
| T-044 | Publish airline to Nostr on creation                       | nostr | T-042, T-043 |
| T-045 | Load existing airline from Nostr on app start              | nostr | T-044        |
| T-046 | Zustand airline store (name, colors, hub, fleet, routes)   | store | T-005, T-021 |
| T-047 | Hub airport highlight on map (special marker for your hub) | map   | T-024, T-046 |
| T-048 | Top bar: airline name, logo placeholder, balance display   | ui    | T-028, T-046 |

**Estimated effort**: 9 tasks, ~2 days with 3 agents. **STATUS: 100% COMPLETE ✅**

---

## Phase 3: Core Economy (The Heartbeat)

**Goal**: The economic simulation works. Demand exists, routes earn money.
**Definition of Done**: Open a route, see demand calculated, set a price, watch revenue tick, see a profit/loss.
**STATUS: 100% COMPLETE ✅**

| ID    | Task                                                          | Zone | Dependencies        |
| ----- | ------------------------------------------------------------- | ---- | ------------------- |
| T-060 | Fixed-point arithmetic utilities (add, sub, mul, div, format) | core | T-002               |
| T-061 | Seeded PRNG (deterministic random from tick number)           | core | T-002               |
| T-062 | Gravity model demand calculation                              | core | T-060, T-020        |
| T-063 | Season calculation from UTC date                              | core | T-002               |
| T-064 | QSI (Quality Service Index) computation                       | core | T-060               |
| T-065 | Revenue calculation (passengers × fare × load factor)         | core | T-060, T-064        |
| T-066 | Cost model (fuel, crew, maintenance, airport fees, leasing)   | core | T-060, T-022        |
| T-067 | Profit/loss computation (revenue − costs)                     | core | T-065, T-066        |
| T-068 | Tick processor: process one simulation tick deterministically | core | T-062 through T-067 |
| T-069 | Determinism test harness (replay N ticks, compare hash)       | core | T-068               |
| T-070 | Route opening action and validation                           | core | T-068               |
| T-071 | Price setting action and validation                           | core | T-068               |

**Estimated effort**: 12 tasks, ~3 days with 1 agent (core is sequential)

---

## Phase 4: Playable MVP 🎮

**Goal**: The game is playable end-to-end for a single player.
**Definition of Done**: Create airline → open route → assign aircraft → watch flights → see revenue/costs → expand. Game loop works.

| ID    | Task                                                                  | Zone  | Dependencies                                  |
| ----- | --------------------------------------------------------------------- | ----- | --------------------------------------------- |
| T-080 | Route creation UI (click origin → click destination → confirm)        | ui    | T-043, T-062                                  |
| T-081 | Route arc visualization on map (animated great-circle arc)            | map   | T-024, T-070                                  |
| T-082 | Demand preview panel (shows economy/biz/first demand for a route)     | ui    | T-062, T-025                                  |
| T-083 | Price setting UI (slider with demand elasticity preview)              | ui    | T-071, T-082                                  |
| T-084 | Aircraft purchase UI (catalog browser with specs)                     | ui    | T-022, T-030                                  |
| T-085 | Flight scheduling and assignment                                      | core  | T-068, T-070                                  |
| T-086 | Aircraft marker on map (icon moving along route arc)                  | map   | T-081, T-085                                  |
| T-087 | Financial dashboard panel (revenue, costs, profit, balance chart)     | ui    | T-067, T-030                                  |
| T-088 | Route performance panel (load factor, revenue per route)              | ui    | T-065, T-087                                  |
| T-089 | Simulation tick runner (interval timer driving the core engine)       | store | T-068, T-046                                  |
| T-090 | Persist game actions as Nostr events (route open, price change, etc.) | nostr | T-042, T-070                                  |
| T-091 | Onboarding tutorial flow (guided first 5 minutes)                     | app   | T-080 through T-088                           |
| T-092 | Cabin chime sound on route creation                                   | audio | _(deferred — `@acars/audio` not yet created)_ |
| T-093 | Revenue tick sound (cash register)                                    | audio | _(deferred — `@acars/audio` not yet created)_ |

**Estimated effort**: 14 tasks, ~3 days with 4 agents. **STATUS: CORE GAMEPLAY COMPLETE ✅** (T-091 onboarding, T-092/T-093 audio deferred)

---

## Phase 5: Multiplayer Competition

**STATUS: 100% COMPLETE ✅**

| Key Features                                                         | Status |
| -------------------------------------------------------------------- | ------ |
| Load other players' airlines from Nostr                              | ✅     |
| Show competitor routes on map (different colors)                     | ✅     |
| QSI-based demand splitting when multiple airlines serve same OD pair | ✅     |
| Competitor notification events (Live Ticker Tape)                    | ✅     |
| Price war dynamics (undercutting detection, demand stimulation)      | ✅     |
| Leaderboard (computed from Nostr events)                             | ✅     |
| **NIP-33 Snapshot Rollups** (attested hashing & compression)         | ✅     |
| **Local Snapshot Index** (Dexie IDB synchronization)                 | ✅     |
| **Background Auditor** (continuous state-drift verification)         | ✅     |

---

## Phase 6: Rich Simulation

**Goal**: The world feels alive with feedback loops, seasons, and dynamic effects.
**Depends on**: Phase 5

| Key Features                                                                   |
| ------------------------------------------------------------------------------ |
| Seasonal demand modulation (summer beach routes, winter ski routes)            |
| Economic cycles (prosperity index oscillation) **(IMPLEMENTED & SURFACED ✅)** |
| Brand score evolution (performance → reputation)                               |
| Market saturation penalties **(IMPLEMENTED & SURFACED ✅)**                    |
| Weather integration (Open-Meteo API → delays → cascading disruptions)          |
| Day/night cycle with real terminator line                                      |
| Airport growth (demand increases based on service quality)                     |

---

## Phase 7: Sensory Polish

**Goal**: The game feels premium and immersive.
**Depends on**: Phase 5

| Key Features                                     |
| ------------------------------------------------ |
| "Music of Your Network" procedural audio         |
| Full aviation sound effects library              |
| CesiumJS 3D globe view (lazy-loaded)             |
| 3D aircraft models (glTF, following flights)     |
| Cockpit camera view                              |
| Visual weather effects on map                    |
| Confetti/celebration animations for achievements |

---

## Phase 8: Social & Depth

**Goal**: Long-term engagement features.
**Depends on**: Phase 6

| Key Features                                      |
| ------------------------------------------------- |
| Alliance system (multi-airline cooperation)       |
| Cargo operations (freight demand, cargo aircraft) |
| Achievement badges (NIP-58)                       |
| Historical mode plugin (start in 1950s)           |
| Airport slot ownership and trading                |
| Merger & acquisition mechanics                    |
| Advanced analytics dashboard                      |

---

## Phase 9: Extreme Scale (The "FlightRadar" Tier)

**Goal**: Support 100,000+ concurrent aircraft without performance loss.
**Depends on**: Phase 7
**Architectural Strategy**: See [SCALABILITY.md](./SCALABILITY.md)

| Key Features                                         |
| ---------------------------------------------------- |
| GPU-Driven Simulation (SLERP in Shaders)             |
| WebGL Custom Layer for instanced aircraft rendering  |
| Off-main-thread Web Worker Engine                    |
| Zero-copy state sharing (SharedArrayBuffer)          |
| Spatial indexing (Quadtree) for view-frustum culling |

---

## Phase Summary

| Phase | Name              | Tasks | Agents | Duration | Milestone                       |
| ----- | ----------------- | ----- | ------ | -------- | ------------------------------- |
| 0     | Foundation        | ~11   | 2      | 2 days   | Monorepo builds ✅              |
| 1     | Static World      | ~12   | 3      | 2 days   | Globe with airports ✅          |
| 2     | Airline Identity  | ~9    | 3      | 2 days   | Create airline on Nostr ✅      |
| 3     | Core Economy      | ~12   | 1      | 3 days   | Simulation engine works ✅      |
| 4     | **Playable MVP**  | ~14   | 4      | 3 days   | **🎮 Game loop works**          |
| 5     | Multiplayer       | ~10   | 3      | 3 days   | Competition system live         |
| 6     | Rich Simulation   | ~12   | 3      | 4 days   | Dynamic world                   |
| 7     | Sensory Polish    | ~10   | 3      | 3 days   | Premium feel                    |
| 8     | Social & Depth    | ~15   | 4      | 5 days   | Long-term engagement            |
| 9     | **Extreme Scale** | ~5    | 2      | 4 days   | **Support 100k+ global planes** |

**Total to MVP (Phases 0–4): ~61 tasks, ~12 days**
**Total to full game (Phases 0–8): ~108 tasks, ~27 days**
