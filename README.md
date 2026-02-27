# ACARS

**Open-Source, Decentralized, Persistent Airline Management MMO on Nostr**

ACARS is a real-world aviation simulation where players build and operate virtual airlines competing on actual routes worldwide. Built for millions of concurrent players with a fully deterministic, client-side game engine backed by the decentralized Nostr protocol.

## Features

### Implemented

- **Deterministic Game Engine** — O(1) macro-economic formulas (Gravity Model, QSI) for route demand and market share
- **Fixed-Point Arithmetic** — No floating-point drift; all financial calculations are cross-platform deterministic
- **Nostr Integration** — Decentralized identity via NIP-07, airline state stored as signed events
- **Real Airport Data** — 6,072 airports from OpenFlights with population, GDP, and seasonal tags
- **Interactive Globe** — MapLibre GL map with virtualized airport selection
- **Fleet Management** — Purchase (BUY/LEASE), aircraft depreciation, and structural condition tracking
- **Operations Ledger** — Detailed financial event history persistent on Nostr (revenue/cost breakdowns)
- **Maintenance System** — Aircraft grounding based on wear-and-tear (Condition < 20%) or flight hours (>600h)
- **Economic Safety Net** — Chapter 11 bankruptcy status to pause operations during severe financial distress
- **Suggested Pricing** — Distance-aware fare intelligence with "Fix to Suggested" optimization shortcuts
- **Route Scheduling** — Real-time aircraft assignment and automated flight operations

### Planned

- Corporate mechanics (IPO, M&A, stock trading, dividends)
- Alliance system with codeshares
- 3D CesiumJS cockpit view
- Procedural audio engine ("the music of your network")
- Bitcoin/Lightning monetization (Zaps, P2E pools)

## Architecture

```
                    ┌──────────────┐
                    │  apps/web    │  React 19 + Vite
                    │  (UI Layer)  │
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ @acars/map   │  │ @acars/store │  │ @acars/nostr │
│ MapLibre GL  │  │ Zustand      │  │ NDK Adapter  │
└──────────────┘  └──────┬───────┘  └──────┬───────┘
                         │                  │
                         ▼                  ▼
                  ┌──────────────┐  ┌──────────────┐
                  │ @acars/core  │  │ @acars/data  │
                  │ Pure Math    │  │ Static Data  │
                  │ Zero Deps    │  │ Airports     │
                  └──────────────┘  └──────────────┘
```

### Key Design Principles

1. **No Central Database** — All game state is a deterministic reduction of Nostr events
2. **1:1 Real-Time** — Game time equals UTC time; a 7-hour flight takes 7 real hours
3. **O(1) Math** — Macro-economic formulas instead of passenger-by-passenger simulation
4. **Fixed-Point Only** — Prevents floating-point desync across clients
5. **Virtualized UI** — All lists use `@tanstack/react-virtual` for scale

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- A NIP-07 browser extension (nos2x, Alby, or Nostr Connect)

### Installation

```bash
# Clone the repository
git clone https://github.com/anabelle/acars.pub.git
cd acars

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open http://localhost:5173 and connect your Nostr extension to create your airline.

### Available Scripts

```bash
pnpm dev          # Start web app in development mode
pnpm build        # Build all packages
pnpm test         # Run tests in watch mode
pnpm test:run     # Run tests once
pnpm lint         # Lint all packages
pnpm typecheck    # Type-check all packages
pnpm clean        # Remove all build artifacts
```

## Project Structure

```
acars/
├── apps/
│   ├── web/                 # React 19 frontend (TanStack Router)
│   │   └── src/
│   │       ├── app/         # Global app setup (Providers, Router)
│   │       ├── routes/      # TanStack Router file-based routes
│   │       ├── shared/      # Reusable UI (buttons, cards, layout)
│   │       └── features/    # Feature modules (fleet, network, etc.)
├── packages/
│   ├── core/                # Pure game engine (zero dependencies)
│   │   └── src/
│   │       ├── fixed-point.ts   # Currency arithmetic
│   │       ├── demand.ts        # Gravity model
│   │       ├── qsi.ts           # Market share allocation
│   │       ├── finance.ts       # Revenue & costs
│   │       ├── fleet.ts         # Depreciation & book value
│   │       └── ...
│   ├── data/                # Static data catalogs
│   │   └── src/
│   │       ├── airports.ts  # 6,072 airports
│   │       └── aircraft.ts  # 15 aircraft models
│   ├── map/                 # MapLibre GL components
│   │   └── src/Globe.tsx    # Interactive globe with routes
│   ├── nostr/               # Nostr I/O layer (NDK)
│   └── store/               # Zustand state management
├── docs/
│   ├── DESIGN_PRINCIPLES.md      # Gameplay vision & UI targets
│   ├── ECONOMIC_MODEL.md    # Math behind demand, QSI, costs
│   ├── CORPORATE_MODEL.md   # Wall Street mechanics (M&A, IPOs)
│   ├── FLEET_MANAGER_PLAN.md    # Aircraft lifecycle
│   ├── MONETIZATION_MODEL.md    # Bitcoin/Lightning revenue
│   ├── SCALABILITY.md       # Map/rendering scaling strategy
│   └── ROADMAP.md           # Development phases
├── .agent/                  # Agent development coordination
└── AGENTS.md                # AI agent onboarding guide
```

## Tech Stack

| Layer           | Technology                 |
| --------------- | -------------------------- |
| Frontend        | React 19, Vite, TypeScript |
| State           | Zustand                    |
| Map             | MapLibre GL                |
| Virtualization  | @tanstack/react-virtual    |
| Networking      | Nostr (NDK)                |
| Identity        | NIP-07 (nos2x, Alby)       |
| Testing         | Vitest                     |
| Package Manager | pnpm workspaces            |

## Economic Model

### Demand Calculation (Gravity Model)

```
Demand = K × (Pop_A^α × Pop_B^β × GDP_A^γ × GDP_B^δ) / Distance^θ
```

Where:

- K = 5.995e-7 (tuned against BOG routes)
- α, β = 0.8 (population exponents)
- γ = 0.6, δ = 0.3 (GDP exponents)
- θ = 1.0 (distance decay, linear)

### Market Share (QSI)

Airlines compete on: price, frequency, travel time, stops, service quality, and brand reputation. Each factor is weighted differently for economy, business, and first-class passengers.

### Revenue & Costs

- **Revenue**: Ticket sales + ancillary ($20/pax)
- **Costs**: Fuel, crew, maintenance, airport fees, navigation, leasing, overhead

See `docs/ECONOMIC_MODEL.md` for full specification.

## Contributing

We welcome contributions! Please read:

- `AGENTS.md` — Engineering rules and constraints
- `docs/AGENT_DEVELOPMENT_PARADIGM.md` — Branching, linting, testing guidelines

### Development Constraints

Every feature must answer: _"If 10,000 players fire this event simultaneously, will it break the math, melt the DOM, or desync the Nostr state?"_

## Documentation

| Document                                                            | Purpose                                           |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| [DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md)                   | Gameplay vision, engagement loops, sensory design |
| [ECONOMIC_MODEL.md](docs/ECONOMIC_MODEL.md)                         | Gravity model, QSI, fixed-point costs             |
| [CORPORATE_MODEL.md](docs/CORPORATE_MODEL.md)                       | IPOs, M&A, bankruptcy, stock mechanics            |
| [FLEET_MANAGER_PLAN.md](docs/FLEET_MANAGER_PLAN.md)                 | Aircraft depreciation, maintenance, commonality   |
| [MONETIZATION_MODEL.md](docs/MONETIZATION_MODEL.md)                 | Bitcoin/Lightning revenue streams                 |
| [SCALABILITY.md](docs/SCALABILITY.md)                                | Map and rendering scaling strategy                |
| [UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md)                       | Frontend stack and cross-platform strategy        |
| [TYCOON_UI_ARCHITECTURE.md](docs/TYCOON_UI_ARCHITECTURE.md)         | Enterprise-grade UI layout and data density       |
| [AGENT_DEVELOPMENT_PARADIGM.md](docs/AGENT_DEVELOPMENT_PARADIGM.md) | Multi-agent coordination and safety contracts     |
| [RESEARCH_SOURCES.md](docs/RESEARCH_SOURCES.md)                     | Bibliography and reference sources                |
| [ROADMAP.md](docs/ROADMAP.md)                                       | Development phases and milestones                 |

## Community & Support

- Issues: use GitHub Issues for bugs and feature requests
- Security: see `SECURITY.md`
- Code of Conduct: see `CODE_OF_CONDUCT.md`

## Visuals

Screenshots and short clips will be added as the UI stabilizes. If you'd like to contribute media, please open a PR with assets in `docs/media`.

## License

MIT

---

**The Prime Directive**: Every commit must respect the millions-scale constraint. No O(N²) loops. No floating-point money. No central database. The game state must be reproducible from the Nostr event log alone.
