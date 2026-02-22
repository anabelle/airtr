import { createFileRoute } from '@tanstack/react-router';
import { PanelLayout } from '@/shared/components/layout/PanelLayout';
import { useAirlineStore } from '@airtr/store';
import { fpFormat } from '@airtr/core';
import { Building2, Landmark, Users, MapPin, Palette } from 'lucide-react';

export const Route = createFileRoute('/corporate')({
  component: CorporateDashboard,
});

function CorporateDashboard() {
  const { airline } = useAirlineStore();

  if (!airline) return null;

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
            <div className="flex items-center space-x-2 text-muted-foreground px-1">
              <MapPin className="h-4 w-4" />
              <span className="text-[10px] uppercase font-bold tracking-wider">Operations Centers (Hubs)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {airline.hubs.map((hub) => (
                <div key={hub} className="rounded-lg border border-border/30 bg-background/30 px-4 py-3 flex items-center justify-between">
                  <span className="font-mono text-lg font-bold text-primary">{hub}</span>
                  <span className="text-[10px] uppercase text-muted-foreground font-semibold px-2 py-0.5 rounded border border-border/30 bg-muted/20">Primary</span>
                </div>
              ))}
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

        {/* Footer simulation info */}
        <div className="mt-auto pt-8 pb-2 text-center">
          <p className="text-[10px] text-muted-foreground/30 font-mono tracking-widest uppercase italic">
            Nostr Registered Identity • Verified On-Chain
          </p>
        </div>
      </div>
    </PanelLayout>
  );
}
