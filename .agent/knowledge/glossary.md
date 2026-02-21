# AirTR Glossary — Domain Terminology

This glossary defines the shared language used across all zones and by all agents.
When a term appears in a task, contract, or ADR, it means EXACTLY what is defined here.

---

## Aviation Terms

**IATA Code**: 3-letter airport code (e.g., JFK, LAX, LHR). Used in UI facing players.

**ICAO Code**: 4-letter airport code (e.g., KJFK, KLAX, EGLL). Used in technical/simulation code.

**OD Pair (Origin-Destination)**: A specific directional route between two airports. LAX→JFK is a different OD pair than JFK→LAX.

**Load Factor**: Percentage of seats filled on a flight. `passengersCarried / seatsAvailable`.

**Yield**: Revenue per passenger-kilometer. A measure of pricing efficiency.

**Block Time**: Total time from gate departure to gate arrival, including taxi.

**Hub**: An airport where an airline concentrates connecting traffic.

**Spoke**: A route from a hub to a smaller destination.

**Codeshare**: A flight operated by one airline but sold under another airline's code.

**Slot**: A reserved time for takeoff or landing at a congested airport.

---

## Game Terms

**Tick**: One simulation cycle. All game state advances by one tick atomically.

**Demand Pool**: The total number of passengers wanting to travel between an OD pair in a given period. Shared among all airlines.

**QSI (Quality Service Index)**: A weighted score determining what fraction of the demand pool each airline captures.

**Gravity Model**: The formula that calculates baseline demand between two airports based on population, GDP, and distance.

**Prosperity Index**: A global economic multiplier that oscillates to simulate boom/bust cycles.

**Brand Score**: An airline's reputation, built over time through performance. Affects QSI.

---

## Architecture Terms

**Zone**: A bounded ownership context in the monorepo (e.g., `@airtr/core`, `@airtr/ui`).

**Contract**: The published, versioned public API of a zone. Lives in `CONTRACT.md`.

**Gate**: An automated verification check that must pass before code reaches trunk.

**Trunk**: The main branch. Always green, always buildable, always correct.

**Task**: A discrete unit of work defined in `.agent/tasks/`. Has clear scope, zone, and acceptance criteria.

**Adapter**: A module that translates between the core domain and an external system (Nostr, MapLibre, CesiumJS, etc.).

**Port**: An interface that defines how the core domain communicates with adapters.

---

## Nostr Terms

**Event**: The fundamental data unit in Nostr. JSON object with `id`, `pubkey`, `kind`, `tags`, `content`, `sig`.

**Kind**: The numeric type of a Nostr event. Determines how relays process it.

**Replaceable Event**: An event where only the latest version is kept (kinds 0, 3, 10000-19999).

**Addressable Event**: An event identified by `pubkey + kind + d-tag` (kinds 30000-39999). Used for game state.

**d-tag**: A tag in addressable events that provides a unique identifier within a kind.

**Relay**: A server that stores and forwards Nostr events.

**NIP**: Nostr Implementation Possibilities — the specification documents for the protocol.

**NDK**: Nostr Development Kit — the TypeScript library we use for Nostr integration.

**Zap**: A Lightning Network payment sent via Nostr (NIP-57).
