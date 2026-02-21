import { useState, useEffect, useCallback } from 'react';
import {
  calculateDemand,
  getProsperityIndex,
  haversineDistance,
  getSeason,
  fpFormat,
  fp,
  fpScale,
} from '@airtr/core';
import type { Airport, Season, FixedPoint } from '@airtr/core';

// --- Global airport data (subset — Phase 1 will load all 7,000+) ---
const AIRPORTS: Airport[] = [
  // Americas
  { id: '3797', name: 'John F Kennedy Intl', iata: 'JFK', icao: 'KJFK', latitude: 40.6398, longitude: -73.7789, altitude: 13, timezone: 'America/New_York', country: 'US', city: 'New York', population: 8_336_817, gdpPerCapita: 76_330, tags: ['business'] },
  { id: '3484', name: 'Los Angeles Intl', iata: 'LAX', icao: 'KLAX', latitude: 33.9425, longitude: -118.408, altitude: 126, timezone: 'America/Los_Angeles', country: 'US', city: 'Los Angeles', population: 3_979_576, gdpPerCapita: 76_330, tags: ['general'] },
  { id: '3830', name: "O'Hare Intl", iata: 'ORD', icao: 'KORD', latitude: 41.9786, longitude: -87.9048, altitude: 672, timezone: 'America/Chicago', country: 'US', city: 'Chicago', population: 2_693_976, gdpPerCapita: 76_330, tags: ['business'] },
  { id: '3878', name: 'Hartsfield-Jackson', iata: 'ATL', icao: 'KATL', latitude: 33.6367, longitude: -84.4281, altitude: 1026, timezone: 'America/New_York', country: 'US', city: 'Atlanta', population: 498_715, gdpPerCapita: 76_330, tags: ['business'] },
  { id: '3690', name: 'Miami Intl', iata: 'MIA', icao: 'KMIA', latitude: 25.7932, longitude: -80.2906, altitude: 8, timezone: 'America/New_York', country: 'US', city: 'Miami', population: 467_963, gdpPerCapita: 76_330, tags: ['beach'] },
  { id: '3361', name: 'São Paulo–Guarulhos', iata: 'GRU', icao: 'SBGR', latitude: -23.4356, longitude: -46.4731, altitude: 2459, timezone: 'America/Sao_Paulo', country: 'BR', city: 'São Paulo', population: 12_325_232, gdpPerCapita: 8_917, tags: ['general'] },
  { id: '2709', name: 'Benito Juárez Intl', iata: 'MEX', icao: 'MMMX', latitude: 19.4363, longitude: -99.0721, altitude: 7316, timezone: 'America/Mexico_City', country: 'MX', city: 'Mexico City', population: 9_209_944, gdpPerCapita: 10_045, tags: ['general'] },
  { id: '2650', name: 'Ministro Pistarini', iata: 'EZE', icao: 'SAEZ', latitude: -34.8222, longitude: -58.5358, altitude: 67, timezone: 'America/Argentina/Buenos_Aires', country: 'AR', city: 'Buenos Aires', population: 3_075_646, gdpPerCapita: 13_650, tags: ['general'] },
  { id: '2816', name: 'El Dorado Intl', iata: 'BOG', icao: 'SKBO', latitude: 4.70159, longitude: -74.1469, altitude: 8361, timezone: 'America/Bogota', country: 'CO', city: 'Bogotá', population: 7_412_566, gdpPerCapita: 6_104, tags: ['general'] },
  { id: '2762', name: 'Arturo Merino Benítez', iata: 'SCL', icao: 'SCEL', latitude: -33.393, longitude: -70.7858, altitude: 1555, timezone: 'America/Santiago', country: 'CL', city: 'Santiago', population: 6_310_000, gdpPerCapita: 15_356, tags: ['general'] },

  // Europe
  { id: '507', name: 'Heathrow', iata: 'LHR', icao: 'EGLL', latitude: 51.4706, longitude: -0.461941, altitude: 83, timezone: 'Europe/London', country: 'GB', city: 'London', population: 8_982_000, gdpPerCapita: 46_510, tags: ['business'] },
  { id: '1382', name: 'Charles de Gaulle', iata: 'CDG', icao: 'LFPG', latitude: 49.0128, longitude: 2.55, altitude: 392, timezone: 'Europe/Paris', country: 'FR', city: 'Paris', population: 2_161_000, gdpPerCapita: 43_518, tags: ['general'] },
  { id: '340', name: 'Frankfurt am Main', iata: 'FRA', icao: 'EDDF', latitude: 50.0333, longitude: 8.57046, altitude: 364, timezone: 'Europe/Berlin', country: 'DE', city: 'Frankfurt', population: 753_056, gdpPerCapita: 51_203, tags: ['business'] },
  { id: '1555', name: 'Adolfo Suárez Madrid–Barajas', iata: 'MAD', icao: 'LEMD', latitude: 40.4719, longitude: -3.56264, altitude: 1998, timezone: 'Europe/Madrid', country: 'ES', city: 'Madrid', population: 3_223_334, gdpPerCapita: 30_103, tags: ['general'] },

  // Asia-Pacific
  { id: '2279', name: 'Narita Intl', iata: 'NRT', icao: 'RJAA', latitude: 35.7647, longitude: 140.386, altitude: 141, timezone: 'Asia/Tokyo', country: 'JP', city: 'Tokyo', population: 13_960_000, gdpPerCapita: 39_285, tags: ['business'] },
  { id: '2188', name: 'Dubai Intl', iata: 'DXB', icao: 'OMDB', latitude: 25.2528, longitude: 55.3644, altitude: 62, timezone: 'Asia/Dubai', country: 'AE', city: 'Dubai', population: 3_478_300, gdpPerCapita: 43_103, tags: ['general'] },
  { id: '3077', name: 'Singapore Changi', iata: 'SIN', icao: 'WSSS', latitude: 1.35019, longitude: 103.994, altitude: 22, timezone: 'Asia/Singapore', country: 'SG', city: 'Singapore', population: 5_686_000, gdpPerCapita: 65_233, tags: ['business'] },
  { id: '3316', name: 'Sydney Kingsford Smith', iata: 'SYD', icao: 'YSSY', latitude: -33.9461, longitude: 151.177, altitude: 21, timezone: 'Australia/Sydney', country: 'AU', city: 'Sydney', population: 5_312_000, gdpPerCapita: 51_812, tags: ['general'] },

  // Africa
  { id: '813', name: 'OR Tambo Intl', iata: 'JNB', icao: 'FAOR', latitude: -26.1392, longitude: 28.246, altitude: 5558, timezone: 'Africa/Johannesburg', country: 'ZA', city: 'Johannesburg', population: 5_783_000, gdpPerCapita: 6_861, tags: ['general'] },
];

interface RouteData {
  origin: Airport;
  destination: Airport;
  distance: number;
  demand: { economy: number; business: number; first: number };
  estimatedDailyRevenue: FixedPoint;
  season: Season;
}

interface UserLocation {
  latitude: number;
  longitude: number;
  source: 'gps' | 'timezone' | 'default';
}

/** Estimate user location from timezone offset as fallback */
function estimateLocationFromTimezone(): UserLocation {
  const offsetMinutes = new Date().getTimezoneOffset();
  // Rough longitude estimate from UTC offset (15° per hour)
  const longitude = -(offsetMinutes / 60) * 15;
  // Rough latitude based on common assumptions
  // Most population lives between 20°N and 50°N
  const latitude = longitude > -100 && longitude < -30 ? 20 : // Americas → ~20°N
    longitude > -15 && longitude < 40 ? 45 :   // Europe → ~45°N
      longitude > 40 && longitude < 80 ? 30 :    // Middle East/South Asia → ~30°N
        longitude > 80 && longitude < 150 ? 35 :   // East Asia → ~35°N
          30;                                         // fallback
  return { latitude, longitude, source: 'timezone' };
}

/** Find the nearest airport to a given location */
function findNearestAirport(lat: number, lon: number): Airport {
  let nearest = AIRPORTS[0];
  let minDist = Infinity;
  for (const airport of AIRPORTS) {
    const dist = haversineDistance(lat, lon, airport.latitude, airport.longitude);
    if (dist < minDist) {
      minDist = dist;
      nearest = airport;
    }
  }
  return nearest;
}

/** Generate interesting routes from a home airport */
function generateRoutes(home: Airport, tick: number): RouteData[] {
  const now = new Date();
  const prosperity = getProsperityIndex(tick);

  // Find closest airports and farthest airports — mix of short/medium/long
  const others = AIRPORTS
    .filter(a => a.iata !== home.iata)
    .map(a => ({
      airport: a,
      distance: haversineDistance(home.latitude, home.longitude, a.latitude, a.longitude),
    }))
    .sort((a, b) => a.distance - b.distance);

  // Pick: 2 short-haul, 2 medium, 2 long-haul
  const picks: Airport[] = [];
  if (others.length >= 2) picks.push(others[0].airport, others[1].airport); // closest
  if (others.length >= 6) picks.push(others[Math.floor(others.length * 0.4)].airport, others[Math.floor(others.length * 0.5)].airport); // medium
  if (others.length >= 4) picks.push(others[others.length - 2].airport, others[others.length - 1].airport); // farthest

  return picks.map(dest => {
    const season = getSeason(dest.latitude, now);
    const distance = haversineDistance(home.latitude, home.longitude, dest.latitude, dest.longitude);
    const demand = calculateDemand(home, dest, season, prosperity);

    // Revenue estimate: realistic fares scale with distance
    const avgFarePerKm = 0.12; // ~$0.12/km average yield
    const baseFare = Math.max(80, Math.round(distance * avgFarePerKm));
    const totalPax = demand.economy + demand.business + demand.first;
    const estimatedDailyRevenue = fpScale(fp(baseFare), totalPax / 7);

    return { origin: home, destination: dest, distance, demand, estimatedDailyRevenue, season };
  });
}

function App() {
  const [tick, setTick] = useState(0);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [homeAirport, setHomeAirport] = useState<Airport | null>(null);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [locationError, setLocationError] = useState(false);

  // Detect user location
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: UserLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            source: 'gps',
          };
          setUserLocation(loc);
          const home = findNearestAirport(loc.latitude, loc.longitude);
          setHomeAirport(home);
          setRoutes(generateRoutes(home, 0));
        },
        () => {
          // Geolocation denied or failed — use timezone fallback
          setLocationError(true);
          const loc = estimateLocationFromTimezone();
          setUserLocation(loc);
          const home = findNearestAirport(loc.latitude, loc.longitude);
          setHomeAirport(home);
          setRoutes(generateRoutes(home, 0));
        },
        { timeout: 5000 },
      );
    } else {
      const loc = estimateLocationFromTimezone();
      setUserLocation(loc);
      const home = findNearestAirport(loc.latitude, loc.longitude);
      setHomeAirport(home);
      setRoutes(generateRoutes(home, 0));
    }
  }, []);

  // Tick the simulation
  useEffect(() => {
    if (!homeAirport) return;
    const interval = setInterval(() => {
      setTick(t => {
        const next = t + 1;
        setRoutes(generateRoutes(homeAirport, next));
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [homeAirport]);

  const prosperity = getProsperityIndex(tick);
  const season = userLocation ? getSeason(userLocation.latitude, new Date()) : 'winter';

  if (!homeAirport || !userLocation) {
    return (
      <div className="app">
        <div className="main-content">
          <div className="hero">
            <h1 className="hero-title">
              <span className="hero-title-accent">Locating you...</span>
            </h1>
            <p className="hero-subtitle">Finding your nearest airport to build your airline.</p>
          </div>
        </div>
      </div>
    );
  }

  const formatPax = (n: number) => n.toLocaleString();
  const formatDist = (km: number) => {
    if (km < 1000) return `${Math.round(km)} km`;
    return `${(km / 1000).toFixed(1)}K km`;
  };

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
            Your hub:&nbsp;
            <span className="hero-title-accent">{homeAirport.iata}</span>
          </h1>
          <p className="hero-subtitle">
            {homeAirport.name}, {homeAirport.city}.
            {userLocation.source === 'gps' ? ' Located via GPS.' : ' Estimated from timezone.'}
            {locationError && ' (Enable location for exact airport)'}
            <br />
            It's <strong>{season}</strong> here.
            The gravity engine is computing demand for {routes.length} routes from your hub.
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

          <div className="ticker">
            <div className="ticker-item">
              <span className="ticker-label">Your Season</span>
              <span className="ticker-value info">{season}</span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Prosperity</span>
              <span className={`ticker-value ${prosperity >= 1 ? 'positive' : 'accent'}`}>
                {(prosperity * 100).toFixed(1)}%
              </span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Airports</span>
              <span className="ticker-value info">{AIRPORTS.length} loaded</span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Location</span>
              <span className="ticker-value accent">
                {userLocation.latitude.toFixed(1)}°, {userLocation.longitude.toFixed(1)}°
              </span>
            </div>
            <div className="ticker-item">
              <span className="ticker-label">Engine</span>
              <span className="ticker-value positive">deterministic ✓</span>
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
