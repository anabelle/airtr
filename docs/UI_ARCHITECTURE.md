# 🖥 UI/UX & Cross-Platform Architecture

## The "Universal Web" Strategy for ACARS

The MVP React application was a quick prototype to prove the decentralized engine. To achieve the "Planetary Scale" ambition defined in the Design Bible, we need an opinionated, robust, and fiercely scalable UI architecture.

We cannot afford brittle CSS, broken routes, or duplicate codebases for Mobile and Desktop.

This document outlines the architecture for the **New Frontend Layer** of ACARS.

---

## 1. The UX Vision: "Bloomberg Terminal meets Flightradar24"

ACARS is an idle-management financial MMO. The UI must feel less like a casual mobile game and more like a high-end corporate dashboard.

- **Dark Mode Default**: Slate/zinc backgrounds with vibrant neon accents for routes and monetary values.
- **Data Density**: High data density using strict typography (e.g., _Inter_ or _Geist_).
- **Infinite Virtualization**: Lists of 10,000 aircraft must scroll flawlessly at 60fps.
- **Glassmorphism & Maps**: The underlying layer is always the dynamic, live WebGL world map. UI panels float above it using glassmorphic backgrounds (`backdrop-blur`).

---

## 2. The Cross-Platform Strategy

Instead of maintaining separate Swift/Kotlin code, or fighting the React Native bridge with heavy WebGL mapping libraries, we will use the **"Universal Web"** approach. We write the UI once, and wrap it natively.

| Target                    | Technology       | Why it's the right choice                                                                                                                                                         |
| :------------------------ | :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web Browser**           | **Vite + PWA**   | Frictionless onboarding via URL. Zero installation required.                                                                                                                      |
| **Desktop (Mac/Win/Lin)** | **Tauri (Rust)** | Wraps the web bundle in a lightweight OS window. Gives us direct multi-threading for the heavy $O(1)$ math and raw TCP WebSocket speeds for Nostr, bypassing browser limitations. |
| **Mobile (iOS/Android)**  | **Capacitor**    | Wraps the web bundle for the App Stores. Allows access to native Haptics (vibrating when buying a plane or receiving a Zap) and Push Notifications for when a dividend is issued. |

Since ACARS relies entirely on purely deterministic client-side mathematics and Nostr WebSockets, wrapping a highly optimized React/Vite/WebGL bundle is the most predictable and performant path.

---

## 3. The Opinionated Frontend Stack

To ensure that any AI Agent or human contributor can build predictably, we are standardizing on the following hyper-opinionated stack:

### 3.1 Routing: TanStack Router

_Why:_ It is 100% type-safe. It generates a route tree dynamically. An AI agent cannot accidentally link to a broken page (`/airline/abc` instead of `/airlines/abc`) because the TypeScript compiler will immediately fail. It is the most robust routing solution for complex web apps in 2024/2025.

> **Implementation Note:** Route-level UI state (such as the active tab in the Route Manager) is stored in type-safe URL search params via `useSearch`/`useNavigate`, making tab state shareable via URL and preservable across navigation. The route search schema is validated at the route definition level (e.g., `validateSearch` in `routes/network.tsx`).

### 3.2 UI Components: Tailwind CSS + Radix UI + CVA (shadcn/ui Pattern)

_Why:_ Traditional CSS (`index.css`) becomes brittle and spaghetti-like at scale. Tailwind provides strict design tokens constraint. We follow the **shadcn/ui component pattern** — accessible Radix UI primitives styled via `class-variance-authority` (CVA), `clsx`, and `tailwind-merge` — that AI agents inherently understand and can compose without writing custom CSS.

> **Implementation Note:** The project uses the same dependency stack as shadcn/ui (`@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`) but components were assembled manually rather than scaffolded via the `npx shadcn-ui` CLI (no `components.json` config exists).

### 3.3 State & Data: Zustand (+ TanStack Query planned)

_Why:_

- `Zustand`: For synchronous, global engine state (the current Tick, the Airline Entity). Currently handles all state management including Nostr relay data via the `@acars/store` layer with direct NDK calls.
- `TanStack Query`: Intended for asynchronous data fetching from Nostr relays (e.g., retrieving historical price data for a stock chart, or querying the global leaderboard).

> **Implementation Note:** `@tanstack/react-query` is declared in `apps/web/package.json` but is **not yet imported or used** anywhere in the source code. All async Nostr data currently flows through direct NDK calls in the `@acars/store` Zustand slices. TanStack Query integration is a future enhancement.

### 3.4 The Map: MapLibre GL JS (Direct API)

_Why:_ Mapbox is proprietary and expensive. MapLibre is open-source, highly performant WebGL, and can render 100,000 pulsing route lines instantly without destroying device battery.

> **Implementation Note:** The map (`packages/map/src/Globe.tsx`) uses **direct `maplibregl.Map()` calls** — not the `react-map-gl` wrapper. The map instance is managed imperatively via `useRef`/`useEffect`, with layers, sources, and animations controlled through the raw MapLibre GL JS API. This gives full control over WebGL rendering, viewport culling, and arc geometry caching for O(1) scalability.
>
> **Livery Rendering:** Aircraft icons use a two-layer SDF approach with 12 family-specific SVG pairs (ATR, Dash8, A220, E-Jet, A320, B737, A330, B787, B777, A350, A380, B747) sourced from tar1090 ADS-B tracker paths and exported via the `FAMILY_ICONS` map in `packages/map/src/icons.ts`. Each family has a body SVG (silhouette) and an accent SVG (detail shapes). The body layer is tinted with the airline's `primary` color and the accent layer with the `secondary` color via MapLibre's `icon-color` paint property. Icon selection uses a 12-way `match` expression on each feature's `familyId` property. Icon size scales with both wingspan (`wingspanM / 35.8 * baseSize` per feature) and zoom level (15% at globe view, 100% at city level) via a zoom-interpolated `icon-size` expression. Colors are resolved per-aircraft from `playerLivery` (for the player's fleet) and `competitorLiveries` (a `Map<pubkey, {primary, secondary}>` for other airlines), attached as GeoJSON feature properties, and read by data-driven style expressions at render time.
>
> **Airport Visualization:** Airport points are classified into a small set of visual tiers (active hub, player hub, route destination, competitor hub, major, default) and rendered with data-driven circle styles. The active hub has a green glow ring, competitor hubs adopt the competitor's primary livery color (fallback orange), and major airports are detected via `HUB_CLASSIFICATIONS` (global/international) or population >= 5M. This provides immediate situational awareness without increasing geometry complexity.
>
> **Airport Info Panel:** Clicking any airport opens a lightweight right-side inspector panel (`apps/web/src/features/network/components/AirportInfoPanel.tsx`). It summarizes airport stats, hub tier, local fleet/routes, competitor presence, and exposes direct actions (open hub, switch hub, open route). The panel is responsive (bottom-anchored on small screens, right-side on larger screens) and dismisses on map click, Escape, or the close button.

### 3.5 Virtualization: TanStack Virtual

_Why:_ DOM nodes are the enemy of performance. If a player looks at the global Fleet Market (used aircraft), there might be 5,000 items. `tanstack/react-virtual` ensures only the 15 items visible on screen actually exist in HTML.

---

## 4. Feature-Sliced Directory Structure

The new `apps/web` will abandon the flat `components/` folder for a predictably scalable **Feature-Sliced Design**. Agents will know exactly where code belongs.

```text
apps/web/
├── src/
│   ├── app/                # Global app setup (Providers, Router init)
│   ├── routes/             # TanStack Router file-based route definitions
│   ├── shared/             # Reusable UI (shadcn buttons, cards, layout layers)
│   │   ├── components/     # e.g., <Button>, <Dialog>, <MapBase>
│   │   └── lib/            # utils, cn() for tailwind
│   └── features/           # The Core Game Modules
│       ├── identity/       # Nostr login, NIP-07, Key setup
│       ├── corporate/      # Stock charts, M&A, Dividends, IPO
│       ├── fleet/          # Buy/Sell aircraft, Maintenance schedules
│       └── network/        # Route creation, Hubs, Map overlays
```

### Anatomy of a Feature

Each feature acts as a mini-library. If an agent is working on the Fleet Manager, they don't touch code anywhere else.

```text
features/fleet/
├── components/       # <AircraftList>, <UsedMarketTable>
├── hooks/            # useFleetValuation(), useBuyAircraft()
├── utils.ts          # Fleet-specific pure functions
└── index.ts          # Public exports for the rest of the app
```

---

## 5. Gamification / Engageability Loops

A robust UI isn't just about code—it's about dopamine.

1. **The Nostr "Zap" Button**: Deeply integrated throughout the UI. If you see a competing CEO on the leaderboard, you can ⚡ Zap them real Sats directly from the UI.
2. **Haptic Feedback**: Leveraging Capacitor's Haptic API. When a major event occurs (your company IPOs, or a hostile takeover begins), the device physically reacts.
3. **Live Ticker Tape**: A constant, scrolling marquee at the bottom of the screen showing global Nostr events: _"✈️ [SkyNova] just purchased an A380"_, _"📉 [Oceanic] has filed Chapter 11"_.

---

This architecture prevents the app from becoming a legacy burden. By relying strictly on type-safe routing, atomic Tailwind styling, and standard feature slices, future agents can confidently add massive new corporate modules without breaking the existing UI.
