# AirTR — Research Sources & References
## Curated bibliography for all design decisions, organized by topic

This document preserves all research findings so future sessions can trace
design decisions back to their sources and verify/update them.

---

## 1. Game Design & Engagement Psychology

### 1.1 Mini Metro — Minimalist Design
- **Key insight**: Simple rules + emergent complexity = deep engagement. Procedural audio where each subway line creates musical notes. Failure is gentle (restart, don't rage-quit). The "less is more" philosophy intensifies focus on core mechanics.
- **Design analysis** (Medium): https://medium.com/@analysis/mini-metro-game-design — Detailed breakdown of the pause-and-strategize mechanic, resource scarcity, and progressive difficulty.
- **Wikipedia**: https://en.wikipedia.org/wiki/Mini_Metro_(video_game) — Genre classification, platform history, reception.
- **Developer talks**: Search "Dinosaur Polo Club GDC talk" for the developers' own design philosophy.

### 1.2 Factorio — Flow State & Addiction
- **Key insight**: "Cracktorio" — the factory-must-grow compulsion loop. Flow state induced by challenge-skill balance. The "one more thing" phenomenon driven by visible optimization opportunities. Tech tree provides clear incremental progression.
- **Psychology analysis** (Reddit, r/gamedesign): Discussions on why Factorio induces flow state and the dopamine of watching complex self-designed systems work autonomously.
- **UX Magazine**: https://uxmag.com — Article on Factorio's information architecture and UI design for complex systems.
- **ResearchGate**: Academic papers on flow state in video games, frequently citing Factorio as a case study.
- **Steam community**: Player discussions on the "one more turn" / "one more belt" trap.

### 1.3 Transport Fever — Infrastructure Meets Economy
- **Key insight**: Historical progression through eras. Your transport routes directly cause town growth (visible impact). Financial feedback loops: profitable lines fund expansion, unprofitable ones force optimization.
- **Comparison with Cities: Skylines**: Transport Fever focuses on logistics while C:S focuses on city-building. Players frequently request a hybrid of both.
- **Steam community**: Discussions on late-game engagement challenges and strategies for sustained play.

### 1.4 Cities: Skylines — Creative Sandbox
- **Key insight**: Creative freedom + emergent traffic simulation. Modding community extends replayability infinitely. Players become emotionally attached to cities they've built.
- **Traffic as gameplay**: The feedback loop of poor road design → congestion → citizen unhappiness → player intervention.
- **Reddit r/CitiesSkylines**: Community discussions on what keeps players engaged for 1000+ hours.

### 1.5 Retention Mechanics (Mobile/F2P Research)
- **Key insight**: Nested engagement loops (micro/session/daily/weekly/seasonal/mastery). Idle mechanics boost retention by rewarding time-away. Daily login rewards establish routine.
- **VGames VC**: https://vgames.vc — Analysis of daily/weekly gameplay loops and login calendars in mobile games. Daily rewards should take <15 minutes.
- **Yellowbrick**: https://yellowbrick.co — Interactive storytelling, adaptive difficulty, and personalization as engagement drivers.
- **Deloitte**: Research on player lifetime value (LTV) and how retention directly correlates with revenue.
- **Fischer Games Blog**: https://andrewfischergames.com — Engagement loop framework: motivation → action → feedback → repeat.
- **Machinations.io**: Tool and articles on modeling game economy feedback loops (positive and negative).

---

## 2. Sound Design & Audio Psychology

### 2.1 Pavlovian Audio Feedback
- **Key insight**: Positive sounds (chimes, beeps) trigger dopamine release. Confirmation sounds create a sense of control and agency. "Cascading transients" hit the dopamine sweet spot. Three ingredients of UI sound: flavor (mood), feedback (satisfying), language (clear meaning).
- **Wavelength Music**: https://wavelengthmusic.com — Article on sound's psychological impact in games and apps.
- **SpeEqual Games**: https://speequalgames.com — Research connecting operant conditioning to game audio feedback.
- **Rare Form Audio**: https://rareformaudio.com — Sound design's role in immersion and emotional connection.
- **Reddit r/GameAudio**: Discussions on UI sound design, the rhythm of satisfying sounds, and cascading transients for dopamine.

### 2.2 Aviation-Specific Sounds
- **Key insight**: The seatbelt sign chime, boarding gate tone, and PA announcement ding are deeply familiar to frequent flyers and aviation enthusiasts. These sounds trigger strong emotional/nostalgic responses (Pavlovian conditioning from real travel experiences).
- **Freesound.org**: https://freesound.org — Clean recreation of Airbus/Boeing cabin chime sounds. Creative Commons licensed.
- **A Sound Effect**: https://asoundeffect.com — Professional aviation sound library (767, 777 passenger jets, helicopters, fighters).
- **Sound Ideas**: https://sound-ideas.com — Commercial aviation sound effect collections.
- **SONNISS**: https://sonniss.com — Game-focused sound effect libraries, annual GDC free bundle.
- **YouTube ASMR**: "Airplane cabin ambience" videos demonstrate the relaxation response to persistent engine hum and cabin sounds.

### 2.3 Web Audio API (Browser Implementation)
- **Key insight**: Web Audio API provides spatial 3D audio, procedural sound generation, and real-time effects processing — all needed for the "Music of Your Network" concept.
- **MDN Web Docs**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API — Complete API reference.
- **MDN Game Audio**: https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games — Game-specific audio guidance.
- **Web.dev**: https://web.dev/articles/webaudio-intro — Spatial audio with AudioListener and PannerNode.
- **Dev.to**: Tutorial on procedural audio generation using OscillatorNode and BiquadFilterNode for ambient textures.
- **SitePoint**: https://sitepoint.com — Using Babylon.js with Web Audio API for 3D spatial sound.

---

## 3. Real-World Data Sources

### 3.1 Airport & Aviation Data
- **OpenFlights**: https://openflights.org/data — Airport database (7,000+ airports), airline database, route database. Open data.
- **OurAirports**: https://ourairports.com/data — Alternative airport database, frequently updated. Public domain.
- **World Bank Open Data**: https://data.worldbank.org — GDP per capita, population data for demand model calibration.

### 3.2 Weather APIs
- **Open-Meteo**: https://open-meteo.com — **Primary choice.** Free, open-source (AGPLv3), no API key required. High-resolution forecasts and historical data from national weather services. GitHub: https://github.com/open-meteo
- **OpenWeatherMap**: https://openweathermap.org — Alternative. Free tier with API call limits.
- **WeatherAPI**: https://weatherapi.com — Alternative. Free tier available.

### 3.3 Sunrise/Sunset
- **SunriseSunset.io**: https://sunrisesunset.io/api — Free API for sunrise/sunset times by lat/lon. Also returns dawn, dusk, golden hour, day length. No auth required.
- **Solar position algorithm**: Can be computed mathematically without an API using NOAA's solar calculator algorithm. Avoids API dependency entirely.

### 3.4 Map & Globe Rendering
- **MapLibre GL JS**: https://maplibre.org — Open-source map rendering library (fork of Mapbox GL). Primary 2D/2.5D view.
- **CesiumJS**: https://cesium.com — 3D geospatial visualization. Used by Flightradar24 for their 3D view. Apache 2.0 license.
- **Natural Earth**: https://naturalearthdata.com — Free vector and raster map data for basemaps.

---

## 4. Nostr Protocol References

### 4.1 Core Protocol
- **NIP-01 (Basic protocol)**: https://github.com/nostr-protocol/nips/blob/master/01.md — Fundamental event structure, event kinds, tags.
- **NIP-78 (Application data)**: https://github.com/nostr-protocol/nips/blob/master/78.md — Kind 30078 for custom application data. Our primary event kind for game state.
- **NIP-57 (Zaps)**: https://github.com/nostr-protocol/nips/blob/master/57.md — Lightning payments via Nostr. For in-game tipping.
- **NIP-58 (Badges)**: https://github.com/nostr-protocol/nips/blob/master/58.md — Achievement badges. For game achievements.
- **Nostr README**: https://github.com/nostr-protocol/nostr — Protocol overview and relay list.

### 4.2 Implementation
- **NDK (Nostr Development Kit)**: https://github.com/nostr-dev-kit/ndk — TypeScript client library. Our chosen Nostr client.
- **Nostr Game Engine (NGE)**: https://github.com/nostr-protocol/nostr-game-engine — Reference implementation of a game on Nostr (jMonkeyEngine-based, not directly applicable but architecturally informative).

---

## 5. Software Architecture References

### 5.1 Hexagonal Architecture
- **Alistair Cockburn (original)**: https://alistair.cockburn.us/hexagonal-architecture/ — Original description of Ports & Adapters.
- **Beyond x Scratch**: https://beyondxscratch.com — Practical guide to implementing hexagonal architecture.
- **GetMidas**: https://getmidas.com — Hexagonal architecture for testability and maintainability.

### 5.2 Event Sourcing / CQRS
- **Martin Fowler**: https://martinfowler.com/eaaDev/EventSourcing.html — Canonical description.
- **Relevance to Nostr**: Nostr's append-only event model is naturally event-sourced. Our game state = reduce(allEvents, initialState).

### 5.3 Domain-Driven Design
- **Martin Fowler (Bounded Contexts)**: https://martinfowler.com/bliki/BoundedContext.html — The concept underlying our zone ownership model.
- **Microsoft DDD Guide**: https://docs.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns — Practical DDD patterns.

### 5.4 Multi-Agent Development
- **GitHub Blog**: https://github.blog — Best practices for AI-generated code review, sandbox environments, human-in-the-loop.
- **Anthropic Evals**: https://anthropic.com — Automated evaluations for coding agents.
- **Cursor Best Practices**: https://cursor.com — Guide to effective AI coding agent workflows (TDD, git discipline, context management).

### 5.5 Monorepo & Trunk-Based Development
- **Graphite**: https://graphite.dev — Trunk-based development in monorepos, feature flags, safe concurrent modification.
- **TrunkBasedDevelopment.com**: https://trunkbaseddevelopment.com — Canonical reference for the development practice.
- **Atlassian**: https://www.atlassian.com/continuous-delivery/continuous-integration/trunk-based-development — CI/CD integration with trunk-based flow.

---

## 6. Internationalization

### 6.1 Libraries
- **i18next**: https://i18next.com — Primary i18n framework. Supports namespaces, lazy loading, pluralization, interpolation.
- **react-i18next**: https://react.i18next.com — React bindings for i18next.
- **i18next-browser-languagedetector**: Auto-detects browser language preference.
- **i18next-http-backend**: Loads translation JSON files on demand (lazy loading).

### 6.2 Best Practices
- **BacancyTech**: https://bacancytechnology.com — Comprehensive guide to React i18n architecture.
- **Dev.to**: Multiple articles on namespace-based organization, TypeScript type-safe keys, and CI integration.
- **SamuelFaj**: https://samuelfaj.com — Backend i18n patterns, database-stored translations, Redis caching.

---

## 7. Airline Industry References (For Game Realism)

### 7.1 Existing Airline Games
- **Airline Tycoon series**: Classic airline management games. Reference for UI patterns and game loops.
- **AirlineSim**: https://airlinesim.aero — Browser-based airline simulation. Good reference for economic model complexity.
- **patsonluk/airline**: https://github.com/patsonluk/airline — Open-source airline game built with Scala. Reference for economic calculations and game balance.
- **World of Airports**: https://worldofairports.com — Mobile airport management game. Reference for casual-friendly onboarding.

### 7.2 Real Airline Economics
- **IATA Economics**: Publications on airline cost structures, load factor industry averages, and yield trends.
- **ICAO Doc 9082**: Policies on airport and air navigation charges (basis for our fee model).
- **Bureau of Transportation Statistics**: https://bts.gov — US airline financial data, schedule data, and on-time performance.

---

## Document Maintenance

- **When adding a new design decision**: Add sources to this file under the relevant topic.
- **When a URL becomes unavailable**: Note it as "[archived]" and add a Wayback Machine link if available.
- **When research contradicts existing decisions**: Create a PROPOSAL in the relevant zone, citing the new source.
