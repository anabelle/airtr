# Grand Strategy & Tycoon UI Architecture

Based on deep research into enterprise software interfaces, city builders (Cities: Skylines), and Grand Strategy games (Paradox Interactive, Victoria 3, Eve Online), navigating extreme data density requires breaking away from standard web-app layouts.

When you have 10,000 active aircraft and thousands of routes, standard pagination and simple lists fail.

## 1. Information Architecture (IA) Hierarchy

A successful simulation game UI follows a strict pyramid of information:

1. **The Macro Layer (Global Context):** The 3D World Map. This is always visible, always moving. It provides immediate spatial awareness of your empire.
2. **The HUD (Heads Up Display):** Anchored to the edges of the screen. Absolute critical metrics (Current Balance, Tick Rate, Global Prosperity, Unread Alerts).
3. **The Lenses (Domain Dashboards):** Modal or docked panels that slide out when interacting with a specific domain (Fleet, Finance, Corporate). These panels consume 30-40% of the screen width, leaving the map visible.
4. **The Micro Layer (Deep Drill-down):** Highly dense data tables with filtering and sorting, reserved for explicit management (e.g., the Used Aircraft Market).

## 2. UI Layout Paradigm: "The Cockpit"

We will abandon the "centered webpage" layout. The UI will hug the edges of the screen to maximize the map view.

### The Shell (`__root.tsx`)

- **Layer 0 (Background):** `WorldMap` (MapLibre GL JS via direct `maplibregl.Map()` usage). Always rendering.
- **Left Edge:** **Sidebar Navigation**. Icons for domains (Overview, Fleet, Network, Corporate, Bank).
- **Top Edge:** **Status Bar**. Company Name, Tier, Brand Score, Cash Balance.
- **Bottom Edge:** **Event Ticker**. Scrolling global Nostr events.
- **Right Edge:** **Context Panel (`<Outlet />`)**. This is where the TanStack router renders the active domain. It will be a glassmorphic sheet that slides in from the right, taking up 400px - 800px depending on the data density requirement.

## 3. Data Presentation Best Practices (Data Density)

- **Eliminate White Space:** Tycoon UIs do not need padding. Use tightly packed tables (e.g., shadcn `Table` with `size="sm"` padding).
- **Iconography over Text:** Instead of writing "Fuel Cost: 5,000/hr", use `[Drop Icon] 5,000/hr`.
- **Color Coding is Semantic:**
  - Green = Positive cash flow.
  - Red = Losses / Bankruptcy.
  - Yellow/Orange = Alerts / Maintenance due.
  - Blue = Informational / Neutral parameters.
- **Progress Bars everywhere:** Visual indicators of capacity (e.g., a route demand bar showing 85% full).
- **Data Binding (Zustand):** As the deterministic engine ticks, the UI must update instantly without causing massive React re-renders. We will bind directly to atomic Zustand selectors where possible.

## 4. Implementation Plan for ACARS

We will rebuild the `__root.tsx` and routes to match this paradigm.

1. `__root.tsx` becomes the master HUD. It includes `IdentityGate`, inside of which we place the Sidebar, Topbar, Ticker, Map, and a flexible right-side container for the `Outlet`.
2. `/` (Dashboard) becomes a macro summary panel (Route counts, Fleet summaries).
3. `/fleet` becomes a dedicated route rendering complex virtualized tables for aircraft management.
4. `/corporate` becomes a dedicated route for Cap Table pie charts and stock trading.
