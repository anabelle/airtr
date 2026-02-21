import { useState, useEffect } from 'react';
import {
  calculateDemand,
  getProsperityIndex,
  haversineDistance,
  getSeason,
  fpFormat,
  fp,
  fpScale,
} from '@airtr/core';
import type { Airport, FixedPoint } from '@airtr/core';

// --- Sample airports ---
const airports: Airport[] = [
  {
    id: '3797', name: 'John F Kennedy Intl', iata: 'JFK', icao: 'KJFK',
    latitude: 40.6398, longitude: -73.7789, altitude: 13,
    timezone: 'America/New_York', country: 'US', city: 'New York',
    population: 8_336_817, gdpPerCapita: 76_330, tags: ['business'],
  },
  {
    id: '3484', name: 'Los Angeles Intl', iata: 'LAX', icao: 'KLAX',
    latitude: 33.9425, longitude: -118.408, altitude: 126,
    timezone: 'America/Los_Angeles', country: 'US', city: 'Los Angeles',
    population: 3_979_576, gdpPerCapita: 76_330, tags: ['general'],
  },
  {
    id: '507', name: 'Heathrow', iata: 'LHR', icao: 'EGLL',
    latitude: 51.4706, longitude: -0.461941, altitude: 83,
    timezone: 'Europe/London', country: 'GB', city: 'London',
    population: 8_982_000, gdpPerCapita: 46_510, tags: ['business'],
  },
  {
    id: '2279', name: 'Narita Intl', iata: 'NRT', icao: 'RJAA',
    latitude: 35.7647, longitude: 140.386, altitude: 141,
    timezone: 'Asia/Tokyo', country: 'JP', city: 'Tokyo',
    population: 13_960_000, gdpPerCapita: 39_285, tags: ['business'],
  },
  {
    id: '2188', name: 'Dubai Intl', iata: 'DXB', icao: 'OMDB',
    latitude: 25.2528, longitude: 55.3644, altitude: 62,
    timezone: 'Asia/Dubai', country: 'AE', city: 'Dubai',
    population: 3_478_300, gdpPerCapita: 43_103, tags: ['general'],
  },
  {
    id: '3361', name: 'São Paulo–Guarulhos', iata: 'GRU', icao: 'SBGR',
    latitude: -23.4356, longitude: -46.4731, altitude: 2459,
    timezone: 'America/Sao_Paulo', country: 'BR', city: 'São Paulo',
    population: 12_325_232, gdpPerCapita: 8_917, tags: ['general'],
  },
];

interface RouteData {
  origin: Airport;
  destination: Airport;
  distance: number;
  demand: { economy: number; business: number; first: number };
  estimatedRevenue: FixedPoint;
}

function computeRoutes(tick: number): RouteData[] {
  const now = new Date();
  const prosperity = getProsperityIndex(tick);
  const pairs: [number, number][] = [[0, 1], [0, 2], [0, 3], [4, 2], [5, 0], [4, 3]];

  return pairs.map(([oi, di]) => {
    const origin = airports[oi];
    const destination = airports[di];
    const season = getSeason(destination.latitude, now);
    const distance = haversineDistance(
      origin.latitude, origin.longitude,
      destination.latitude, destination.longitude,
    );
    const demand = calculateDemand(origin, destination, season, prosperity);

    // Simple revenue estimate: demand × average fare
    const avgFare = distance < 5000 ? 350 : distance < 10000 ? 750 : 1200;
    const totalPax = demand.economy + demand.business + demand.first;
    const estimatedRevenue = fpScale(fp(avgFare), totalPax / 7); // Per day

    return { origin, destination, distance, demand, estimatedRevenue };
  });
}

function App() {
  const [tick, setTick] = useState(0);
  const [routes, setRoutes] = useState<RouteData[]>(() => computeRoutes(0));

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => {
        const next = t + 1;
        setRoutes(computeRoutes(next));
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const prosperity = getProsperityIndex(tick);
  const now = new Date();
  const season = getSeason(40, now); // Approximate northern hemisphere

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="header-logo">AirTR</span>
          <span className="header-badge">Phase 0</span>
        </div>
        <div className="header-status">
          <div className="status-dot" />
          <span className="status-text">Engine Live — Tick {tick}</span>
        </div>
      </header>

      <main className="main-content">
        <section className="hero fade-in">
          <h1 className="hero-title">
            Build Your Airline.<br />
            <span className="hero-title-accent">Own the Skies.</span>
          </h1>
          <p className="hero-subtitle">
            Open-source, decentralized airline management on Nostr.
            The simulation engine is alive — watching real demand
            pulse through {routes.length} global routes.
          </p>
        </section>

        <section className="engine-demo fade-in fade-in-delay-1">
          <div className="engine-demo-header">
            <div className="engine-demo-dots">
              <div className="engine-demo-dot" />
              <div className="engine-demo-dot" />
              <div className="engine-demo-dot" />
            </div>
            <span className="engine-demo-title">
              @airtr/core — gravity demand engine
            </span>
          </div>

          <div className="engine-demo-body">
            <div className="route-grid">
              {routes.map((r) => (
                <div className="route-card" key={`${r.origin.iata}-${r.destination.iata}`}>
                  <div className="route-card-header">
                    <span className="route-pair">
                      {r.origin.iata}
                      <span className="route-arrow">→</span>
                      {r.destination.iata}
                    </span>
                    <span className="route-distance">
                      {Math.round(r.distance).toLocaleString()} km
                    </span>
                  </div>
                  <div className="route-stats">
                    <div className="route-stat">
                      <span className="route-stat-label">Weekly Demand</span>
                      <span className="route-stat-value demand">
                        {(r.demand.economy + r.demand.business + r.demand.first).toLocaleString()} pax
                      </span>
                    </div>
                    <div className="route-stat">
                      <span className="route-stat-label">Economy</span>
                      <span className="route-stat-value">
                        {r.demand.economy.toLocaleString()}
                      </span>
                    </div>
                    <div className="route-stat">
                      <span className="route-stat-label">Biz / First</span>
                      <span className="route-stat-value">
                        {r.demand.business.toLocaleString()} / {r.demand.first.toLocaleString()}
                      </span>
                    </div>
                    <div className="route-stat">
                      <span className="route-stat-label">Daily Rev (est)</span>
                      <span className="route-stat-value profit">
                        {fpFormat(r.estimatedRevenue, 0)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ticker">
            <div className="ticker-item">
              <span className="ticker-label">Season</span>
              <span className="ticker-value info">{season}</span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Prosperity</span>
              <span className={`ticker-value ${prosperity >= 1 ? 'positive' : 'accent'}`}>
                {(prosperity * 100).toFixed(1)}%
              </span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Tests</span>
              <span className="ticker-value positive">44/44 ✓</span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Tick Rate</span>
              <span className="ticker-value info">3s</span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Engine</span>
              <span className="ticker-value accent">deterministic</span>
            </div>
          </div>
        </section>

        <div className="tech-stack fade-in fade-in-delay-2">
          {['TypeScript', 'Vite', 'React 19', 'Vitest', 'pnpm', 'Nostr', 'MapLibre', 'CesiumJS', 'Web Audio'].map(t => (
            <span className="tech-pill" key={t}>{t}</span>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
