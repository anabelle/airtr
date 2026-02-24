import { createFileRoute } from '@tanstack/react-router';
import { PanelLayout } from '@/shared/components/layout/PanelLayout';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { fpFormat } from '@airtr/core';
import { Building2, Landmark, Users, MapPin, Palette, CheckCircle2 } from 'lucide-react';
import { AirlineTimeline } from '@/features/airline/components/Timeline';
import { HubPicker } from '@/features/network/components/HubPicker';
import type { Airport } from '@airtr/core';

export const Route = createFileRoute('/corporate')({
  component: CorporateDashboard,
});

function CorporateDashboard() {
  const { airline, updateAirlineHubs } = useAirlineStore();
  const { homeAirport, setHub } = useEngineStore();

  if (!airline) return null;

  const handleAddHub = async (airport: Airport | null) => {
    if (!airport || airline.hubs.includes(airport.iata)) return;
    const newHubs = [...airline.hubs, airport.iata];
    await updateAirlineHubs(newHubs);
  };

  const handleSwitchActiveHub = (iata: string) => {
    // Note: In a production app, we would fetch the full Airport object from @airtr/data 
    // but since we already have the IATA, we can find it.
    const { airports } = require('@airtr/data');
    const airport = airports.find((a: any) => a.iata === iata);
    if (airport) {
      setHub(
        airport,
        { latitude: airport.latitude, longitude: airport.longitude, source: 'manual' },
        'manual switch'
      );
    }
  };

  return (
    <PanelLayout>
      <div className="flex h-full w-full flex-col p-6 overflow-y-auto custom-scrollbar">
        <div className="mb-8 flex items-center justify-between pr-10">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Corporate Holding</h2>
          </div>
          <span className="rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-semibold uppercase text-primary">
            {airline.status} entity
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Identity Card */}
          <div className="rounded-xl border border-border/50 bg-background/50 p-5 space-y-4">
            <div className="flex items-center space-x-2 text-muted-foreground">
              <Landmark className="h-4 w-4" />
              <span className="text-[10px] uppercase font-bold tracking-wider">Legal Identity</span>
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{airline.name}</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-xs font-mono text-muted-foreground">{airline.icaoCode}</span>
                <span className="text-[10px] text-muted-foreground/50 text-center">•</span>
                <span className="text-xs font-mono text-muted-foreground">{airline.callsign}</span>
              </div>
            </div>
          </div>

          {/* Capital Card */}
          <div className="rounded-xl border border-border/50 bg-background/50 p-5 space-y-4">
            <div className="flex items-center space-x-2 text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="text-[10px] uppercase font-bold tracking-wider">Equity Value</span>
            </div>
            <div>
              <p className="text-xl font-bold text-green-400">{fpFormat(airline.corporateBalance, 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Current Liquidity</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Hubs Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center space-x-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span className="text-[10px] uppercase font-bold tracking-wider">Operations Centers (Hubs)</span>
              </div>
              <HubPicker currentHub={null} onSelect={handleAddHub} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {airline.hubs.map((hub) => {
                const isActive = homeAirport?.iata === hub;
                return (
                  <div key={hub} className={`rounded-lg border p-4 flex items-center justify-between transition-all ${isActive ? 'bg-primary/5 border-primary/40' : 'bg-background/30 border-border/30 grayscale opacity-80'}`}>
                    <div className="flex items-center space-x-3">
                      <span className="font-mono text-xl font-black text-foreground">{hub}</span>
                      {isActive && (
                        <span className="flex items-center text-[9px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Active Hub
                        </span>
                      )}
                    </div>
                    {!isActive && (
                      <button
                        onClick={() => handleSwitchActiveHub(hub)}
                        className="text-[10px] font-bold uppercase text-muted-foreground hover:text-foreground hover:bg-white/5 border border-white/10 px-3 py-1.5 rounded transition-all"
                      >
                        Establish Here
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Livery Preview Section */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-muted-foreground px-1">
              <Palette className="h-4 w-4" />
              <span className="text-[10px] uppercase font-bold tracking-wider">Corporate Livery</span>
            </div>
            <div className="rounded-lg border border-border/30 bg-background/30 p-4">
              <div className="flex items-center space-x-4">
                <div className="flex-1 h-12 rounded-lg border border-border/50 flex overflow-hidden shadow-inner">
                  <div className="h-full" style={{ width: '70%', backgroundColor: airline.livery.primary }} />
                  <div className="h-full" style={{ width: '30%', backgroundColor: airline.livery.secondary }} />
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-foreground">Standard Scheme</p>
                  <p className="text-[10px] text-muted-foreground">Edition V1.0</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline Section */}
        <div className="mt-8 mb-4 flex items-center space-x-2 text-muted-foreground px-1">
          <Landmark className="h-4 w-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Operational Audit Trail (Ledger)</span>
        </div>
        <div className="rounded-xl border border-border/50 bg-background/50 overflow-hidden">
          <AirlineTimeline />
        </div>

        {/* Footer simulation info */}
        <div className="mt-8 pt-8 pb-4 text-center">
          <p className="text-[10px] text-muted-foreground/30 font-mono tracking-widest uppercase italic border-t border-white/5 pt-4">
            Nostr Registered Identity • Verified Operations Ledger
          </p>
        </div>
      </div>
    </PanelLayout>
  );
}
