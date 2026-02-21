import { type FormEvent, useState } from 'react';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { HubPicker } from './HubPicker.js';
import type { Airport } from '@airtr/core';

export function AirlineCreator() {
    const { createAirline, identityStatus, initializeIdentity, isLoading, error } = useAirlineStore();
    const homeAirport = useEngineStore(s => s.homeAirport);
    const setHub = useEngineStore(s => s.setHub);

    const [name, setName] = useState('');
    const [icao, setIcao] = useState('');
    const [callsign, setCallsign] = useState('');
    const [primary, setPrimary] = useState('#1a1a2e');
    const [secondary, setSecondary] = useState('#e94560');

    const handleHubChange = (airport: Airport | null) => {
        if (!airport) return;
        setHub(
            airport,
            { latitude: airport.latitude, longitude: airport.longitude, source: 'manual' },
            'manual selection'
        );
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!homeAirport) return;

        await createAirline({
            name,
            icaoCode: icao.toUpperCase(),
            callsign: callsign.toUpperCase(),
            hubIata: homeAirport.iata,
            livery: {
                primary,
                secondary,
                accent: '#ffffff'
            }
        });
    };

    // ── State: Checking for extension ──
    if (identityStatus === 'checking') {
        return (
            <div className="airline-creator">
                <h2>Connecting…</h2>
                <p>Checking for Nostr extension…</p>
            </div>
        );
    }

    // ── State: No extension found ──
    if (identityStatus === 'no-extension') {
        return (
            <div className="airline-creator">
                <h2>Nostr Extension Required</h2>
                <p>
                    AirTR uses Nostr for decentralized airline identity.
                    Install a NIP-07 browser extension to play.
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Recommended: <strong>nos2x</strong>, <strong>Alby</strong>, or <strong>Nostr Connect</strong>
                </p>
                <button onClick={initializeIdentity} disabled={isLoading}>
                    {isLoading ? 'Retrying…' : 'Retry Connection'}
                </button>
                {error && <p className="error">{error}</p>}
            </div>
        );
    }

    // ── State: Ready — show create airline form ──
    return (
        <form className="airline-creator" onSubmit={handleSubmit}>
            <h2>Found Your Airline</h2>
            {error && <p className="error">{error}</p>}

            {/* ── Hub Selection (the #1 strategic decision) ── */}
            <div className="airline-creator-hub">
                <label className="airline-creator-hub-label">Home Hub</label>
                {homeAirport ? (
                    <div className="airline-creator-hub-display">
                        <span className="airline-creator-hub-iata">{homeAirport.iata}</span>
                        <span className="airline-creator-hub-name">{homeAirport.name}, {homeAirport.city}</span>
                        <span className="airline-creator-hub-country">{homeAirport.country}</span>
                    </div>
                ) : (
                    <p className="airline-creator-hub-detecting">Detecting nearest airport…</p>
                )}
                {homeAirport && <HubPicker currentHub={homeAirport} onSelect={handleHubChange} />}
                <p className="airline-creator-hub-hint">
                    Your hub is your base of operations.
                    All routes start here. Choose wisely — it defines your network.
                </p>
            </div>

            {/* ── Airline Identity ── */}
            <label>
                Airline Name
                <input name="airline-name" required value={name} onChange={e => setName(e.target.value)} placeholder="Aurora Airlines" autoComplete="off" spellCheck={false} />
            </label>
            <label>
                ICAO Code (3 Letters)
                <input name="airline-icao" required maxLength={3} value={icao} onChange={e => setIcao(e.target.value)} placeholder="AUR" autoComplete="off" spellCheck={false} />
            </label>
            <label>
                Callsign
                <input name="airline-callsign" required value={callsign} onChange={e => setCallsign(e.target.value)} placeholder="AURORA" autoComplete="off" spellCheck={false} />
            </label>

            {/* ── Livery Colors ── */}
            <div className="colors">
                <label>
                    Primary Color
                    <input name="primary-color" type="color" value={primary} onChange={e => setPrimary(e.target.value)} />
                </label>
                <label>
                    Secondary Color
                    <input name="secondary-color" type="color" value={secondary} onChange={e => setSecondary(e.target.value)} />
                </label>
            </div>

            <button type="submit" disabled={isLoading || !homeAirport}>
                {isLoading ? 'Publishing to Nostr…' : `Found Airline at ${homeAirport?.iata ?? '…'}`}
            </button>
        </form>
    );
}
