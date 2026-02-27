# ACARS — Design Bible
## Open-Source, Decentralized, Persistent Airline Management Game on Nostr

---

## Table of Contents
1. [Design Philosophy](#1-design-philosophy)
2. [Engagement Architecture](#2-engagement-architecture)
3. [Sensory Design](#3-sensory-design)
4. [Real-World Data Integration](#4-real-world-data-integration)
5. [Personalization & Identity](#5-personalization--identity)
6. [Internationalization](#6-internationalization)
7. [Audience Strategy](#7-audience-strategy)
8. [Forever Architecture](#8-forever-architecture)
9. [Scalability & The "Millions" Constraint](#9-scalability--the-millions-constraint)
10. [Security & Trustless Validation](#10-security--trustless-validation)

---

## 1. Design Philosophy

### The Inspiration Cocktail

| Game | What We Steal | Why It Works |
|------|--------------|--------------|
| **Mini Metro** | Minimalist visual language, emergent complexity from simple rules, procedural audio that makes the system *musical* | Strips away noise. Every element on screen matters. Failure is gentle — you restart, not rage-quit. The system *sings* when it works well. |
| **Factorio** | "The factory must grow" compulsion loop, incremental progression, flow state induction, visible system interconnection | The dopamine of watching a complex system you built work autonomously. The "one more thing" trap. Every optimization reveals the next bottleneck. |
| **Transport Fever** | Historical progression, infrastructure-meets-economy, visual feedback of towns growing because of YOUR routes | Your actions have visible, lasting impact on the world. Towns grow where you build. The world responds to you. |
| **Cities: Skylines** | Creative sandbox freedom, traffic-as-gameplay, modding ecosystem, visual city growth | Players become *attached* to what they build. The creative freedom means no two games are alike. |
| **Cities in Motion** | Pure transport simulation, timetable management, passenger flow visualization, financial pressure | The tension between creating beautiful networks and profitable ones. Passengers have preferences and will choose alternatives. |

### Core Design Tenets

1. **Simple rules, emergent complexity** — Like Mini Metro, the rules should fit on a napkin. The depth comes from their interaction.
2. **Visible systems** — Like Factorio, players should SEE passengers flowing, money moving, aircraft flying. No hidden magic.
3. **Your world grows** — Like Transport Fever, your routes should visibly affect demand, airport growth, and the world economy.
4. **Zen and tension** — Like Mini Metro's calm aesthetic with underlying pressure, the game should feel relaxing yet engaging.
5. **The one-more-turn trap** — Like Factorio/Civilization, each tick should reveal something that demands "just one more..."

### The Ambition: Planetary Scale
This game is designed to be a **trendsetter in Nostr game development** and the premier real-world persistent simulation on the protocol. It must be built to eventually support **millions of players trading tens of thousands of active flights** concurrently.
Every single technical and game design decision MUST respect this reality.
*   **No $O(N^2)$ Loops**: If your math or logic requires iterating over every passenger or every route every tick, it will fail at scale. We use macro-economic formulas (like the Gravity Model and QSI) that resolve in $O(1)$ time regardless of passenger volume.
*   **No Central Database**: We do not use PostgreSQL or Redis. All state is a deterministic reduction of a decentralized Nostr event log. The client does the heavy lifting.
*   **Virtualize Everything in UI**: We cannot render 10,000 DOM nodes. All lists, maps, and tables must use WebGL instancing or React virtualization.

---

## 2. Engagement Architecture

### 2.1 The Engagement Loop Stack

Games that retain players for years use **nested engagement loops** operating at different timescales:

```
┌─────────────────────────────────────────────────────────────────┐
│  MICRO LOOP (seconds)                                           │
│  Action → Feedback → Satisfaction                               │
│  "I clicked to add a route → saw the line draw → heard chime"   │
├─────────────────────────────────────────────────────────────────┤
│  SESSION LOOP (minutes to hours)                                │
│  Goal → Execution → Reward → New Goal                           │
│  "I want LAX→JFK profitable → adjusted price → hit 80% load    │
│   factor → now I want to add Tokyo"                             │
├─────────────────────────────────────────────────────────────────┤
│  DAILY LOOP (24 hours)                                          │
│  Check in → See what happened → React → Plan                   │
│  "My flights ran overnight → revenue came in → competitor       │
│   opened a route on my turf → need to respond"                  │
├─────────────────────────────────────────────────────────────────┤
│  WEEKLY LOOP (7 days)                                           │
│  Review → Adjust strategy → See trends → Set goals             │
│  "This week economy class was more profitable than business →   │
│   should I shift my fleet mix?"                                 │
├─────────────────────────────────────────────────────────────────┤
│  SEASONAL LOOP (months)                                         │
│  Expansion → Competition → Adaptation → Mastery                │
│  "Summer demand spike for resort routes → I planned ahead →     │
│   captured the market → earned the 'Season King' badge"         │
├─────────────────────────────────────────────────────────────────┤
│  MASTERY LOOP (forever)                                         │
│  Legacy → Reputation → Teaching others → Becoming legend        │
│  "I've built the #1 airline → now I mentor new players →        │
│   my brand is recognized across relays"                         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 The "Idle" Dimension — Persistent World Advantage

Because the world is **persistent and tick-based**, the game works EVEN WHEN YOU'RE NOT PLAYING. 
Critically, **Time in ACARS is exactly 1:1 with Real-World UTC Time**. Like Flightradar24, if a plane takes 7 hours to fly from JFK to LHR in reality, it takes exactly 7 hours in the game. You do not fast-forward time.

- Your flights continue to fly and earn revenue in real-time
- Competitors may open routes on your turf while you sleep
- Seasons change, demand shifts
- Your brand reputation evolves

**This turns "checking in" into a reward loop.** Like checking your stocks or a farm game, the act of opening the app reveals *what happened while you were away*. This is the most potent retention mechanic in mobile gaming, and we get it for free from the persistent world design.

**Notification hooks (via Nostr events):**
- 🔔 "Your LAX→CDG route hit 90% load factor!"
- ⚠️ "Competitor 'SkyNova' just opened a route competing with your JFK→LHR"
- 💰 "Weekly revenue report: +$2.3M this week (+12% vs last week)"
- 🏆 "You earned the 'First Million' badge!"
- 📉 "Warning: Your ORD→SFO route is losing money at current pricing"

### 2.3 Progression Systems

#### Tech Tree / Unlock Path
Like Factorio's research tree, but for airline capabilities:

```
Tier 1: Regional Startup
  └─ Domestic routes only (<2000km)
  └─ 3 aircraft types (turboprops, small jets)
  └─ Economy class only
  └─ Single hub

Tier 2: National Carrier
  └─ Continental routes (<5000km)
  └─ 10 aircraft types (medium jets)
  └─ Economy + Business class
  └─ Up to 3 hubs
  └─ Basic alliance membership

Tier 3: Intercontinental Player
  └─ Worldwide routes
  └─ 20+ aircraft types (widebodies)
  └─ All cabin classes
  └─ Cargo operations
  └─ Hub-and-spoke optimization tools

Tier 4: Global Mega-Carrier
  └─ Full aircraft catalog (30+ types)
  └─ Alliance leadership
  └─ Airport slot ownership
  └─ Route monopoly potential
  └─ Brand licensing
```

Progression is gated by **cumulative revenue, passenger count, and route count** — not time or pay-to-win. This creates the Factorio-style "I can see the next tier, I just need to optimize a bit more" compulsion.

#### Achievements / Badges (NIP-58)

Grouped by **discovery** (exploring), **mastery** (optimization), **social** (community), and **legacy** (long-term):

**Discovery:**
- 🌍 "Globe Trotter" — Operate routes on all 6 continents
- 🏝️ "Island Hopper" — Serve 10 island airports
- 🧊 "Polar Route" — Fly a route above 60° latitude
- 🌙 "Red-Eye Pioneer" — Operate your first overnight flight

**Mastery:**
- 📊 "Perfect Load" — Achieve 95%+ load factor on any route
- 💎 "Profit Margin King" — Maintain 20%+ profit margin for 30 days
- ⚡ "Efficiency Expert" — Reduce average cost-per-pax by 15%
- 🎯 "Price Sniper" — Find the perfect price point (max revenue × load)

**Social:**
- 🤝 "Alliance Builder" — Form an alliance with 3+ airlines
- 💬 "Industry Voice" — Receive 100 zaps on a game update note
- 🎓 "Mentor" — Help 5 new players reach Tier 2
- ⚔️ "Rival" — Compete head-to-head on 5+ routes with same player

**Legacy:**
- 👑 "Market Dominance" — #1 airline by revenue for 90 consecutive days
- 🏗️ "Institution" — Operate continuously for 1 year
- 🌟 "Legend" — Earn all other badges

### 2.4 Feedback Loops (Positive & Negative)

**Positive feedback (snowball):**
- More flights → more brand recognition → more passengers → more revenue → more aircraft → more flights
- Higher load factors → better financial performance → ability to lower prices → even more passengers

**Negative feedback (rubber band / catch-up):**
- Market saturation → lower load factors for everyone → least efficient airline exits → market corrects
- Overcapitalization → high fixed costs → vulnerability during economic downturns
- Reputation damage from cancellations or poor service → passenger loss → harder to recover

**These opposing forces create a dynamic equilibrium** — the game never "solves itself" because each success creates new challenges.

---

## 3. Sensory Design

### 3.1 Sound Architecture

Sound is the **#1 underutilized engagement tool** in browser games. For aviation geeks, specific sounds trigger deep emotional responses — the boarding chime, the engine spool, the seatbelt sign ding. We leverage this ruthlessly.

#### Sound Categories

```
@acars/audio/
├── system/                    ← UI interaction sounds
│   ├── click.mp3             ← Subtle, satisfying UI click
│   ├── hover.mp3             ← Soft hover whisper
│   ├── success.mp3           ← Achievement earned (ascending chimes)
│   ├── error.mp3             ← Gentle warning tone
│   ├── notification.mp3      ← Inbox/alert (aviation-flavored)
│   └── transition.mp3        ← View change swoosh
│
├── aviation/                  ← The Pavlovian triggers 🛩️
│   ├── cabin-chime.mp3       ← THE seatbelt sign ding (dopamine hit)
│   ├── boarding-tone.mp3     ← Gate boarding announcement chime
│   ├── engine-spool.mp3      ← Jet engine starting up
│   ├── takeoff-rumble.mp3    ← Wheels leaving ground
│   ├── landing-clunk.mp3     ← Gear touching down
│   ├── pa-chime.mp3          ← "Ladies and gentlemen" PA chime
│   └── cabin-ambience.mp3    ← Low hum for 3D cockpit view
│
├── economy/                   ← Financial feedback sounds
│   ├── revenue-tick.mp3      ← Cash register-style on revenue
│   ├── profit-positive.mp3   ← Upward chime (money earned)
│   ├── profit-negative.mp3   ← Gentle downward tone (losing money)
│   ├── milestone.mp3         ← Big achievement (symphony swell)
│   └── market-alert.mp3      ← Competitor action notification
│
└── ambient/                   ← Atmospheric soundscapes
    ├── airport-terminal.mp3  ← Busy terminal background
    ├── control-tower.mp3     ← Radio chatter ambience
    ├── rain-tarmac.mp3       ← Rain on airport tarmac
    └── night-airport.mp3     ← Quiet nighttime airport
```

#### Audio Engine Design (Web Audio API)

```typescript
// @acars/audio/engine.ts — Conceptual Architecture

interface AudioLayer {
  id: string;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  pannerNode?: PannerNode;  // For 3D spatial audio
  loop: boolean;
  volume: number;
}

class ACARSAudioEngine {
  private ctx: AudioContext;
  private layers: Map<string, AudioLayer>;
  private masterGain: GainNode;
  
  // Ambient layers that play continuously
  startAmbience(timeOfDay: 'day' | 'night' | 'dawn' | 'dusk') { }
  
  // Event-driven one-shots with Pavlovian timing
  playCabinChime() { }      // On route opened
  playRevenueClick() { }    // On each revenue tick
  playBoardingTone() { }    // On flight departing
  playMilestone() { }       // On badge earned
  
  // Procedural audio: each metro line in Mini Metro 
  // has a unique note — each of YOUR routes has a unique 
  // timbre that blends into the ambient soundscape
  assignRouteTimbre(routeId: string, distance: number) { }
  
  // The "Music of Your Network" — inspired by Mini Metro
  // As flights depart and arrive, they trigger musical notes
  // A busy network sounds GOOD. A failing one sounds dissonant.
  updateNetworkSymphony(activeFlights: Flight[]) { }
}
```

**The "Music of Your Network" concept** (inspired directly by Mini Metro):
- Each route is assigned a musical note based on its distance/direction
- Short domestic routes → high, quick notes (staccato)
- Long international routes → deep, sustained notes (legato)
- When a flight departs → its note plays softly
- When a flight arrives → its note resolves
- A thriving network creates an ambient, procedural soundtrack
- A failing network (cancellations, delays) creates dissonance
- **The player literally HEARS when their airline is healthy or sick**

### 3.2 Visual Feedback Language

Every action has a visual signature:

| Event | Visual Feedback |
|-------|----------------|
| Route opened | Animated arc draws between airports with a soft glow |
| Flight departing | Aircraft icon pulses briefly, trail begins |
| Revenue earned | Small floating "+$XXX" number near the route |
| Load factor rising | Route arc color shifts from red (empty) → yellow → green (full) |
| Competition entering | Competitor's arc appears alongside yours (different color) |
| Season changing | Map color temperature shifts (warm summer → cool winter) |
| Day/night cycle | Real-time lighting on the globe, airport lights twinkle at night |
| Badge earned | Full-screen momentary celebration with confetti particles |
| Financial milestone | Dashboard briefly glows gold |

### 3.3 Haptic Feedback (Mobile Future)
- Light vibration on route creation
- Double-tap pulse on achievement
- Sustained subtle vibration during 3D cockpit turbulence

---

## 4. Real-World Data Integration

### 4.1 Weather Integration

**Open-Meteo API** (free, no API key, open source):

```typescript
// Fetch weather for any airport in real-time
const weather = await fetch(
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
);
```

**How weather affects gameplay:**
- **Visual**: Rain, clouds, snow rendered on the map/globe near airports
- **Gameplay**: Severe weather can delay flights → cascading schedule disruptions
- **Seasonal**: Weather patterns drive seasonal demand (snow → ski resort demand up)
- **Sound**: Rain on tarmac ambient sound when zoomed into a rainy airport

### 4.2 Day/Night Cycle

**SunriseSunset.io API** or computed mathematically (solar position algorithm):

- Globe shows real-time day/night terminator line
- Airports in nighttime show runway lights, warm terminal glow
- Flights crossing the terminator show beautiful dawn/dusk transitions
- 3D view cockpit shows realistic sky color based on solar position
- **Ambient sound shifts**: night airports are quieter, fewer terminal announcements

### 4.3 Seasonal Calendar

Computed from real UTC date (no API needed):

```typescript
function getSeason(latitude: number, date: Date): Season {
  const month = date.getMonth();
  const isNorthern = latitude > 0;
  if (month >= 2 && month <= 4) return isNorthern ? 'spring' : 'autumn';
  if (month >= 5 && month <= 7) return isNorthern ? 'summer' : 'winter';
  if (month >= 8 && month <= 10) return isNorthern ? 'autumn' : 'spring';
  return isNorthern ? 'winter' : 'summer';
}
```

**Seasonal effects on gameplay:**
- Summer: +30% demand to beach/resort destinations, -10% business travel
- Winter: +40% demand to ski destinations, +20% holiday travel
- Spring/Autumn: Baseline demand, shoulder-season pricing opportunities
- Visual: Map terrain subtly shifts (greener in summer, whiter in winter at high latitudes)

### 4.4 Real Airport Data Enrichment

Beyond OpenFlights static data, each airport gets:
- **Timezone** (from tz database — already in OpenFlights)
- **Current local time** (computed, displayed on airport info panel)
- **Sunrise/sunset** (computed from position + date)
- **Current weather** (Open-Meteo, cached per airport, refreshed hourly)

For the aviation geek: clicking an airport shows real local time, weather, and what the sky looks like there *right now*. This is the kind of "nitpicker" detail that turns casual users into devoted fans.

---

## 5. Personalization & Identity

### 5.1 Airline Branding

Your airline is YOUR identity. It's published as a Nostr addressable event and visible to all players:

```json
{
  "kind": 30078,
  "tags": [["d", "airtr:airline"]],
  "content": {
    "name": "Aurora Airlines",
    "icao": "AUR",
    "callsign": "AURORA",
    "hubs": ["JFK"],
    "founded": "2026-02-20",
    "livery": {
      "primary": "#1a1a2e",
      "secondary": "#e94560",
      "accent": "#16213e",
      "logoUrl": "nostr:nevent1...",
      "pattern": "stripe"
    },
    "slogan": "Where the sky meets the stars",
    "description": "A boutique carrier focused on premium transatlantic service"
  }
}
```

**Livery customization features:**
- Color picker for primary/secondary/accent colors
- Pattern templates: stripe, gradient, two-tone, retro, modern
- Logo upload (stored as Nostr event, referenced by nevent)
- Preview on 3D aircraft model before committing
- Your livery appears on YOUR aircraft on other players' maps

**Why this matters psychologically:**
- Avatar customization is proven to increase player identification and emotional investment
- Seeing YOUR branded aircraft flying on the global map creates pride of ownership
- Other players seeing your livery creates social visibility and reputation
- The livery becomes part of your Nostr identity — portable, permanent, yours

### 5.2 Fleet Naming

Each aircraft can be individually named (like real airlines name their planes):
- "Spirit of Adventure" (Boeing 787-9)
- "City of London" (Airbus A380)
- Custom registration numbers

These names appear in the flight info panel when anyone clicks on your flight.

### 5.3 CEO Title & Avatar

Your Nostr profile (NIP-01, kind 0) serves as your CEO identity:
- Profile picture = CEO photo
- Display name = CEO name
- Banner = Your airline's livery/branding
- Bio = Your airline's story

### 5.4 Alliance Identity

Alliances (groups of airlines) get their own branding:
- Alliance name, colors, logo
- Shared codeshare flights
- Alliance leaderboard
- Group Nostr relay for coordination

---

## 6. Internationalization

### 6.1 Architecture

**i18next + react-i18next** with namespace-based lazy loading:

```
packages/
└── @acars/i18n/
    ├── index.ts              ← i18next setup, language detection
    ├── locales/
    │   ├── en/
    │   │   ├── common.json   ← Shared UI strings
    │   │   ├── game.json     ← Game-specific terms
    │   │   ├── airports.ts   ← Airport names (English)
    │   │   ├── aircraft.json ← Aircraft type names
    │   │   └── tutorial.json ← Tutorial strings
    │   ├── es/
    │   │   ├── common.json
    │   │   ├── game.json
    │   │   └── ...
    │   ├── ja/
    │   ├── zh/
    │   ├── de/
    │   ├── fr/
    │   ├── pt/
    │   ├── ar/               ← RTL support
    │   └── ko/
    └── types/
        └── keys.d.ts         ← TypeScript type-safe translation keys
```

### 6.2 Design Principles

1. **Internationalize from Day 1** — Never hardcode strings. Even MVP.
2. **Namespace by feature** — Load only what's needed (lazy)
3. **Type-safe keys** — Generate TypeScript types from translation files
4. **RTL support** — Arabic, Hebrew, etc. from the start (CSS logical properties)
5. **Number/currency formatting** — Use `Intl.NumberFormat` for locale-aware numbers
6. **Date/time formatting** — Use `Intl.DateTimeFormat` for locale-aware dates
7. **Pluralization** — i18next handles complex plural rules per language
8. **Community-driven translations** — Open PR model for new languages

### 6.3 Aviation-Specific i18n

Some things are *intentionally* not translated:
- **IATA/ICAO codes** (JFK, KJFK are universal)
- **Aircraft type designators** (B737, A320 are universal)
- **Callsigns** (spoken in English globally in real aviation)
- **Aviation terminology options** — Let user choose: localized names OR IATA codes

---

## 7. Audience Strategy

### 7.1 Player Archetypes

| Archetype | What They Want | How We Serve Them | Retention Hook |
|-----------|---------------|-------------------|----------------|
| **The Aviation Geek** 🛩️ | Realism, real aircraft, real airports, real data, cabin chimes | Detailed aircraft specs, real routes, livery editor, aviation sounds | "This game has the EXACT cabin chime from a 787" |
| **The Optimizer** 📊 | Spreadsheets, efficiency, min-maxing, perfect systems | Detailed financial analytics, route optimizer, QSI visibility | "I found a route with 23% margins that no one else is serving" |
| **The Empire Builder** 👑 | Growth, scale, domination, seeing their airline everywhere | Globe view showing global network, leaderboards, alliance system | "My airline is now the 3rd largest in the game" |
| **The Creative** 🎨 | Beautiful liveries, elegant route networks, aesthetics | Livery editor, beautiful route map visualization, airline branding | "Look at my airline's aesthetic — it's gorgeous" |
| **The Socializer** 💬 | Competition, alliances, community, reputation | Nostr social feed, alliance chat, zap tipping, leaderboards | "Our alliance just beat the #1 alliance in weekly revenue" |
| **The Casual** 🧘 | Relaxing, ambient, check-in-and-go, no stress | Idle progression, weekly summaries, peaceful ambient soundscape | "I check my airline twice a day and it's like meditation" |

### 7.2 Onboarding Flow

**Critical**: The first 5 minutes determine if a player stays forever or leaves.

```
Step 1: "Create Your Airline" (30 seconds)
  → Name your airline
  → Pick primary colors
  → Choose a hub airport (world map with highlighted major airports)
  → Generate or import Nostr keys
  
Step 2: "Your First Route" (60 seconds)
  → Guided to click your hub, then click a nearby airport
  → See the demand, projected revenue, suggested price
  → "Open Route" button → satisfying arc animation + cabin chime

Step 3: "Your First Aircraft" (60 seconds)  
  → Offered 3 starter aircraft with clear tradeoffs
  → Small turboprop (cheap, short range)
  → Regional jet (medium, versatile)
  → Medium jet (expensive, longer range)
  → Select one → it appears on the map at your hub

Step 4: "Watch It Fly" (120 seconds)
  → Your first flight departs → aircraft moves along route
  → Revenue ticks up in real-time as passengers board
  → Load factor bar fills → satisfying green
  → "You just made your first $12,000!" celebration

Step 5: "The World Awaits" (open-ended)
  → Tutorial tips fade
  → Full map unlocks
  → "You have $X remaining — where will you expand?"
```

**Total onboarding: ~5 minutes to "I own an airline and it's making money."**

---

## 8. Forever Architecture

### 8.1 Hexagonal / Ports & Adapters Architecture

The game engine uses **Hexagonal Architecture** (Ports & Adapters) to ensure the core logic is completely isolated from any external dependency:

```
                        ┌─────────────────────┐
                        │   EXTERNAL WORLD     │
                        │  (UI, Nostr, APIs)   │
                        └──────────┬──────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │         ADAPTERS             │
                    │                              │
                    │  ┌──────────────────────┐    │
                    │  │ NostrAdapter          │   │ ← Adapter: speaks Nostr
                    │  │ MapLibreAdapter       │   │ ← Adapter: speaks MapLibre
                    │  │ CesiumAdapter         │   │ ← Adapter: speaks CesiumJS
                    │  │ WebAudioAdapter       │   │ ← Adapter: speaks Web Audio
                    │  │ WeatherAPIAdapter     │   │ ← Adapter: speaks Open-Meteo
                    │  │ StorageAdapter        │   │ ← Adapter: IndexedDB/localStorage
                    │  └──────────────────────┘    │
                    │              │                │
                    │     ┌────────┼────────┐       │
                    │     │     PORTS        │       │
                    │     │  (Interfaces)    │       │
                    │     └────────┼────────┘       │
                    │              │                │
                    └──────────────┼──────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │         CORE DOMAIN          │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │ Economy Engine          │ │ ← Pure math. No dependencies.
                    │  │ Simulation Engine       │ │ ← Deterministic tick processor.
                    │  │ Airline Domain          │ │ ← Fleet, routes, finances.
                    │  │ World Domain            │ │ ← Airports, demand, geography.
                    │  │ Validation Rules        │ │ ← What's legal in this game.
                    │  └────────────────────────┘  │
                    │                              │
                    │  ZERO external dependencies  │
                    │  ZERO side effects           │
                    │  100% deterministic           │
                    │  100% unit testable           │
                    └──────────────────────────────┘
```

**Why this matters for "forever":**
- Core game logic **never needs to change** when you swap UI framework, map library, or even leave Nostr
- The core can run in browser, Node.js, Deno, Bun, a game relay, a test harness — anywhere
- 10 years from now, if CesiumJS is obsolete, you swap the adapter, not the game
- New contributors can work on the core without knowing React, or on the UI without knowing game math

### 8.2 Plugin Architecture

The game is extensible through a plugin system:

```typescript
// Plugin interface
interface ACARSPlugin {
  id: string;
  name: string;
  version: string;
  
  // Lifecycle hooks
  onInit(context: PluginContext): void;
  onTick?(tick: GameTick): void;
  onEvent?(event: NostrEvent): void;
  onDestroy(): void;
  
  // UI extension points
  panels?: PanelDefinition[];           // Add new panels
  mapLayers?: MapLayerDefinition[];     // Add map layers
  menuItems?: MenuItemDefinition[];     // Add menu items
  
  // Store extensions
  stores?: Record<string, StoreDefinition>;
}

// Example plugins that could be built:
// - Cargo operations plugin
// - Airport construction plugin
// - Historical mode (start in 1950s)
// - Realistic fuel price tracking
// - ATC communication simulator
// - Airline merger & acquisition mechanics
// - Stock market simulation
// - Weather-disruption scenarios
```

### 8.3 Event-Sourced State

All game state is derived from an **ordered sequence of events** (CQRS/Event Sourcing pattern):

```
Event Log (Nostr events, ordered by created_at):
  t=0: AirlineCreated { name: "Aurora", hub: "KJFK" }
  t=1: AircraftPurchased { type: "B737-800", id: "AUR001" }
  t=2: RouteOpened { from: "KJFK", to: "KLAX", pricing: {...} }
  t=3: FlightScheduled { route: "KJFK-KLAX", aircraft: "AUR001" }
  ...

Current State = reduce(validate(allEvents), initialState)
```

**Why this is perfect for our game:**
1. **Nostr IS an event log** — events are naturally append-only
2. **Any client can reconstruct any state** by replaying events from relays
3. **Time travel** — you can see the state at any point in history
4. **Auditing** — every action is recorded, signed, and verifiable
5. **Debugging** — reproduce any bug by replaying the event sequence
6. **Forking** — create alternate "what-if" scenarios by branching the event stream

**Implementation note:** the current public world id is `dev-v3`, and clients load action logs only (snapshot APIs are disabled for this world).

### 8.4 Modular Package Boundaries

Each package has a clear contract and can evolve independently:

```
                 ┌──────────────┐
                 │  apps/web    │  The main application
                 │  (React/Vite)│  Composes everything
                 └──────┬───────┘
                        │ imports
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌─────────────┐ ┌──────────────┐
│ @acars/map   │ │ @acars/store│ │ @acars/nostr │
│ MapLibre     │ │ Zustand     │ │ NDK Adapter  │
│ Globe, Arcs  │ │ State mgmt  │ │ Events I/O   │
└──────┬───────┘ └──────┬──────┘ └──────┬───────┘
       │                │               │
       └────────────┬───┘───────────────┘
                    │ depends on
                    ▼
            ┌──────────────┐
            │ @acars/core  │  Pure domain logic
            │              │  Zero external deps
            └──────┬───────┘
                   │ depends on
                   ▼
           ┌───────────────┐
           │ @acars/data   │  Static data
           │ Airports, etc │  Aircraft catalog
           └───────────────┘

    ┌────────────────────────────────────────────┐
    │  PLANNED (not yet implemented):            │
    │  @acars/ui    — Shared React components    │
    │  @acars/3d    — CesiumJS 3D globe view     │
    │  @acars/audio — Web Audio API sound engine  │
    │  @acars/i18n  — i18next translations        │
    └────────────────────────────────────────────┘
```

### 8.5 Testing Strategy

```
Unit Tests (fast, pure, no I/O):
  @acars/core  — gravity model, QSI, pricing, costs, tick processor
  Result: "The math works"

Integration Tests (Zustand stores + core):
  @acars/store — actions → store updates → correct state
  Result: "The state management works"

Component Tests (React components):
  @acars/ui — panels render correctly with mock data
  Result: "The UI renders"

E2E Tests (browser, Playwright):
  apps/web — onboarding flow, route creation, 3D view toggle
  Result: "The app works end-to-end"

Simulation Tests (deterministic replay):
  @acars/core — replay 1000 ticks with known events → verify final state hash
  Result: "The simulation is deterministic across runs"
```

### 8.6 Sustainability Patterns

**For an open-source project that lasts:**

1. **Comprehensive `CONTRIBUTING.md`** — Lower the barrier for new contributors
2. **Architecture Decision Records (ADRs)** — Document WHY, not just WHAT
3. **Modular ownership** — Different maintainers can own different packages
4. **No vendor lock-in** — Every external dependency is behind an adapter/port
5. **Semantic versioning** — For each package independently
6. **CI/CD from day 1** — GitHub Actions, automated tests, deploy previews
7. **Living documentation** — This design bible, kept in the repo, updated with every major change
8. **Community-first features** — Plugin system means community can extend without core changes
9. **Dogfooding** — We play our own game publicly, sharing our airline stories on Nostr
10. **Value-for-value** — NIP-57 zaps let the community fund development directly

---

## Summary: What Makes This Game Addictive

| Principle | How We Implement It |
|-----------|-------------------|
| **Instant gratification** | First flight in 5 minutes. Revenue in seconds. |
| **Visible progress** | Aircraft on the map. Routes glowing. Revenue ticking. |
| **Meaningful choices** | Every price change, route, and aircraft purchase matters to the economy. |
| **Social stakes** | Other real humans are competing on the same routes. Your reputation is your Nostr identity. |
| **Sensory richness** | Aviation sounds trigger emotional responses. The network "sings" when healthy. |
| **Idle progression** | The world runs even when you sleep. Opening the app reveals what happened. |
| **Personalization** | Your airline looks, sounds, and feels like YOURS. |
| **Emergent stories** | "Remember when SkyNova tried to undercut us on LAX→NRT and we both nearly went bankrupt?" |
| **Infinite mastery** | The economy is complex enough that there's always a better strategy to find. |
| **Real-world grounding** | Real airports, real weather, real day/night. The world feels ALIVE. |

---

## 9. Scalability & The "Millions" Constraint

To achieve our goal of supporting **millions of concurrent players** operating **tens of thousands of planes**, ACARS uses a **Macro-Economic Deterministic Architecture**.

### 9.1 Math vs Micro-Agents
We do NOT simulate individual passengers pathfinding through networks (which burns CPU). We use top-down formulas:
- **Gravity Model**: `Demand = K * (Pop_A * Pop_B) / Distance^1.2`. Calculates total route demand in $O(1)$ time.
- **QSI (Quality Service Index)**: Acts as a market-share multiplier. If an airline's QSI yields 30% share, they instantly get 30% of the route demand.

### 9.2 Event Sourcing via Nostr
We avoid centralized database meltdowns by pushing the write-load to the decentralized Nostr protocol:
- Purchasing planes or opening routes simply broadcasts signed NIP-33 events.
- The game client pulls the events and reduces them deterministically.
- **Scale property**: The read/write load is horizontally distributed natively by the protocol.

### 9.3 Overcoming UI and Floating-Point Bottlenecks
- **React/DOM Thrashing**: Prevented by relying on MapLibre GL for the globe array (WebGL handles 100k+ instances easily) and `@tanstack/react-virtual` for any UI lists.
- **Floating-Point Desync**: Because state is processed client-side, $10.01 + $5.00 cannot yield $15.0100000001 on some machines. ALL financial math is strictly enforced as **Fixed-Point Arithmetic** using integers (e.g., $10.50 is stored as `105000`).
- **Tick Loop O(N²)**: The engine's tick processor must rely on highly indexed structures (`Map<Route, Airline[]>`) instead of deeply nested array scanning.

*When an agent works on this codebase, they must evaluate every new feature through the lens: "Does this break if 10,000 airlines fire it at once?"*

---

## 10. Security & Trustless Validation

Because ACARS is a completely serverless, decentralized game running on the Nostr protocol, the client has ultimate authority over what it broadcasts. **We operate in a Zero-Trust Environment.** Players can and will attempt to spoof payloads, double-spend funds, or modify other players' airlines by broadcasting manually crafted events to relays. 

The deterministic simulation engine must treat every incoming event as hostile until proven otherwise.

### 10.1 Zero-Trust Payload Validation (Anti-Spoofing)

Nostr events represent **Intents to Act**, not **State Updates**.

- **Never Trust Payload Variables:** If a user broadcasts an event `PurchaseAircraft` with a payload of `{"cost": 1000, "type": "B737"}`, the simulation engine must completely ignore the `"cost": 1000`. The engine must look up the correct, canonical fixed-point cost from the immutable `@acars/data` catalog. 
- **State is Derived, Never Accepted:** A client cannot broadcast an event that asserts state, such as `{"action": "UpdateBalance", "newBalance": 5000000}`. They can only broadcast `{"action": "OpenRoute", "from": "JFK", "to": "LHR"}`. The local deterministic engine computes the deduction.

### 10.2 Sequential Processing & Double-Spend Prevention

In a decentralized network, a malicious actor might broadcast multiple `PurchaseAircraft` events simultaneously, hoping they are all processed before the client's treasury balance drops below zero.

- **Strict Deterministic Ordering:** All events must be ordered strictly by their `created_at` timestamp. In the event of a collision (same timestamp), ties must be broken deterministically by sorting the event IDs lexicographically.
- **Sequential State Checks:** During the tick reduction process, the engine must process events one at a time. It applies Event A, mutates the state (deducting the balance), and then evaluates Event B against that new state. If Event B no longer has sufficient funds, the validation fails and Event B is permanently ignored or marked as `REJECTED` in the state tree.

### 10.3 Cryptographic Ownership & Authorization

A Nostr relay will accept any validly formatted event from any pubkey. The engine must enforce the authorization bounds.

- **Signature Verification:** Every action that mutates an `AirlineEntity` must be cryptographically signed by the exact Nostr pubkey that founded that airline, or a pubkey explicitly granted delegated authority within the entity's Cap Table.
- **Pre-Engine Filtering:** Invalid signatures or unauthorized actors attempting to modify another player's airline (e.g., trying to rename an airline they don't own) must be caught by the validation layer before the event ever enters the core state reducer.
