import { useEngineStore } from '@airtr/store';
import { airports as AIRPORTS } from '@airtr/data';
import { getProsperityIndex } from '@airtr/core';

export function Ticker() {
    const season = useEngineStore((s) => s.routes.length > 0 ? s.routes[0]?.season : 'winter');
    const tick = useEngineStore((s) => s.tick);
    const homeAirport = useEngineStore((s) => s.homeAirport);

    const prosperity = getProsperityIndex(tick);

    if (!homeAirport) return null;

    return (
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
                <span className="ticker-label">Hub</span>
                <span className="ticker-value accent">{homeAirport.iata}</span>
            </div>
            <div className="ticker-item">
                <span className="ticker-label">Engine</span>
                <span className="ticker-value positive">deterministic ✓</span>
            </div>
        </div>
    );
}
