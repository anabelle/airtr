import { useEffect } from 'react';
import { fpFormat } from '@airtr/core';
import type { Airport } from '@airtr/core';
import { airports as AIRPORTS, findPreferredHub } from '@airtr/data';
import { Globe } from '@airtr/map';
import { useEngineStore } from '@airtr/store';
import type { UserLocation } from '@airtr/store';

import { HubPicker } from './components/HubPicker.js';
import { Ticker } from './components/Ticker.js';
import { AirlineCreator } from './components/AirlineCreator.js';
import { useAirlineStore } from '@airtr/store';

/** Fallback: estimate location from UTC offset */
function estimateLocationFromOffset(): UserLocation {
  const offsetMinutes = new Date().getTimezoneOffset();
  const longitude = -(offsetMinutes / 60) * 15;
  const latitude = 30; // rough global average
  return { latitude, longitude, source: 'timezone' };
}


/** IANA timezone detection */
function findAirportByTimezone(): Airport | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matches = AIRPORTS.filter(a => a.timezone === tz);
    if (matches.length > 0) {
      return [...matches].sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    }

    const tzCity = tz.split('/').pop()?.replace(/_/g, ' ').toLowerCase();
    if (tzCity) {
      const cityMatches = AIRPORTS.filter(a => a.city.toLowerCase() === tzCity);
      if (cityMatches.length > 0) {
        return [...cityMatches].sort((a, b) => (b.population || 0) - (a.population || 0))[0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function App() {
  const tick = useEngineStore(s => s.tick);
  const homeAirport = useEngineStore(s => s.homeAirport);
  const userLocation = useEngineStore(s => s.userLocation);
  const routes = useEngineStore(s => s.routes);
  const setHub = useEngineStore(s => s.setHub);
  const startEngine = useEngineStore(s => s.startEngine);
  const { airline, initializeIdentity, updateHub } = useAirlineStore();

  useEffect(() => {
    initializeIdentity();
  }, [initializeIdentity]);

  // Sync Nostr profile's hub with Engine state if they diverge (e.g., initial load)
  useEffect(() => {
    if (airline && homeAirport && airline.hubs[0] !== homeAirport.iata) {
      const dbHub = AIRPORTS.find(a => a.iata === airline.hubs[0]);
      if (dbHub) {
        setHub(
          dbHub,
          { latitude: dbHub.latitude, longitude: dbHub.longitude, source: 'manual' },
          'nostr profile'
        );
      }
    }
  }, [airline, homeAirport, setHub]);

  // Initialize hub from location
  useEffect(() => {
    // Strategy 1: Try GPS
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: UserLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            source: 'gps',
          };
          const home = findPreferredHub(loc.latitude, loc.longitude);
          setHub(home, loc, 'GPS');
          startEngine();
        },
        () => {
          // GPS failed — try IANA timezone
          const tzAirport = findAirportByTimezone();
          if (tzAirport) {
            const loc: UserLocation = {
              latitude: tzAirport.latitude,
              longitude: tzAirport.longitude,
              source: 'timezone',
            };
            setHub(tzAirport, loc, `timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
          } else {
            const loc = estimateLocationFromOffset();
            const home = findPreferredHub(loc.latitude, loc.longitude);
            setHub(home, loc, 'UTC offset (imprecise)');
          }
          startEngine();
        },
        { timeout: 3000 },
      );
    } else {
      const tzAirport = findAirportByTimezone();
      if (tzAirport) {
        const loc: UserLocation = {
          latitude: tzAirport.latitude,
          longitude: tzAirport.longitude,
          source: 'timezone',
        };
        setHub(tzAirport, loc, `timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
      } else {
        const loc = estimateLocationFromOffset();
        const home = findPreferredHub(loc.latitude, loc.longitude);
        setHub(home, loc, 'UTC offset');
      }
      startEngine();
    }
  }, [setHub, startEngine]);

  const handleHubChange = (airport: Airport | null) => {
    if (!airport) return;
    setHub(
      airport,
      { latitude: airport.latitude, longitude: airport.longitude, source: 'manual' },
      'manual selection'
    );
    // If airline exists, persist hub change to Nostr
    if (airline) {
      updateHub(airport.iata);
    }
  };

  const formatPax = (n: number) => n.toLocaleString();
  const formatDist = (km: number) => {
    if (km < 1000) return `${Math.round(km)} km`;
    return `${(km / 1000).toFixed(1)}K km`;
  };

  if (!homeAirport || !userLocation) {
    return (
      <div className="app">
        <div className="main-content">
          <div className="hero">
            <h1 className="hero-title">
              <span className="hero-title-accent">Locating you…</span>
            </h1>
            <p className="hero-subtitle">Finding your nearest airport to build your airline.</p>
          </div>
        </div>
      </div>
    );
  }

  const season = routes[0]?.season ?? 'winter';

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="header-logo">AirTR</span>
          <span className="header-badge" style={{ backgroundColor: airline?.livery.primary, color: airline?.livery.secondary }}>
            {airline ? airline.name : 'Phase 2'}
          </span>
        </div>
        <div className="header-status">
          <div className="status-dot" />
          <span className="status-text">Engine Live — Tick {tick}</span>
        </div>
      </header>

      <Globe
        airports={AIRPORTS}
        selectedAirport={homeAirport}
        onAirportSelect={handleHubChange}
        className="map-bg"
      />

      <main className="main-content has-map">
        <section className="hero fade-in">
          {!airline ? (
            <AirlineCreator />
          ) : (
            <>
              <h1 className="hero-title">
                Welcome, CEO of <span className="hero-title-accent">{airline.name}</span>
              </h1>
              <p className="hero-subtitle">
                Your primary hub is <strong>{airline.hubs[0]}</strong> ({homeAirport.name}).<br />
                It's <strong>{season}</strong> — {routes.length} routes computing.
              </p>
              <HubPicker currentHub={homeAirport} onSelect={handleHubChange} />
            </>
          )}
        </section>

        <section className="engine-demo fade-in fade-in-delay-1">
          <div className="engine-demo-header">
            <div className="engine-demo-dots">
              <div className="engine-demo-dot" />
              <div className="engine-demo-dot" />
              <div className="engine-demo-dot" />
            </div>
            <span className="engine-demo-title">
              @airtr/core — routes from {homeAirport.iata} ({homeAirport.city})
            </span>
          </div>

          <div className="engine-demo-body">
            <div className="route-grid">
              {routes.map((r) => {
                const total = r.demand.economy + r.demand.business + r.demand.first;
                return (
                  <div className="route-card" key={`${r.origin.iata}-${r.destination.iata}`}>
                    <div className="route-card-header">
                      <span className="route-pair">
                        {r.origin.iata}
                        <span className="route-arrow">→</span>
                        {r.destination.iata}
                      </span>
                      <span className="route-distance">{formatDist(r.distance)}</span>
                    </div>
                    <div className="route-stats">
                      <div className="route-stat">
                        <span className="route-stat-label">Weekly Demand</span>
                        <span className="route-stat-value demand">{formatPax(total)} pax</span>
                      </div>
                      <div className="route-stat">
                        <span className="route-stat-label">Econ / Biz / First</span>
                        <span className="route-stat-value">
                          {formatPax(r.demand.economy)} / {formatPax(r.demand.business)} / {formatPax(r.demand.first)}
                        </span>
                      </div>
                      <div className="route-stat">
                        <span className="route-stat-label">Daily Rev (est)</span>
                        <span className="route-stat-value profit">{fpFormat(r.estimatedDailyRevenue, 0)}</span>
                      </div>
                      <div className="route-stat">
                        <span className="route-stat-label">Season @ dest</span>
                        <span className="route-stat-value">{r.season}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Ticker />
        </section>

        <div className="tech-stack fade-in fade-in-delay-2">
          {['TypeScript', 'Vite', 'React 19', 'Vitest', 'pnpm', 'Nostr', 'MapLibre', 'CesiumJS', 'Zustand'].map(t => (
            <span className="tech-pill" key={t}>{t}</span>
          ))}
        </div>
      </main>
    </div >
  );
}

export default App;
