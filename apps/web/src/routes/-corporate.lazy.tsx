import { PanelLayout } from '@/shared/components/layout/PanelLayout';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { fp, fpFormat, fpScale, fpSub } from '@airtr/core';
import { getHubPricingForIata } from '@airtr/data';
import { Building2, Landmark, Users, MapPin, Palette, CheckCircle2 } from 'lucide-react';
import { AirlineTimeline } from '@/features/airline/components/Timeline';
import { HubPicker } from '@/features/network/components/HubPicker';
import type { Airport } from '@airtr/core';
import { useMemo, useState } from 'react';

export default function CorporateDashboard() {
  const { airline, modifyHubs } = useAirlineStore();
  const homeAirport = useEngineStore(s => s.homeAirport);
  const [pendingAction, setPendingAction] = useState<{ type: 'add' | 'switch' | 'remove'; iata: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const currentMonthlyOpex = useMemo(
    () => airline?.hubs.reduce((sum, hub) => sum + getHubPricingForIata(hub).monthlyOpex, 0) ?? 0,
    [airline?.hubs]
  );

  const handleAddHub = async (airport: Airport | null) => {
    if (!airport || !airline || airline.hubs.includes(airport.iata)) return;
    setActionError(null);
    setPendingAction({ type: 'add', iata: airport.iata });
  };

  const handleSwitchActiveHub = async (iata: string) => {
    setActionError(null);
    setPendingAction({ type: 'switch', iata });
  };

  const handleCloseHub = async (iata: string) => {
    setActionError(null);
    setPendingAction({ type: 'remove', iata });
  };

  const confirmHubAction = async () => {
    if (!pendingAction || !airline) return;
    setIsProcessing(true);
    setActionError(null);
    try {
      await modifyHubs(pendingAction);
      setPendingAction(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete hub action';
      setActionError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const pendingPricing = pendingAction ? getHubPricingForIata(pendingAction.iata) : null;
  const pendingSetupFee = pendingPricing ? fp(pendingPricing.openFee) : fp(0);
  const pendingRelocationFee = pendingPricing ? fpScale(fp(pendingPricing.openFee), 0.25) : fp(0);
  const pendingCost = pendingAction?.type === 'add'
    ? pendingSetupFee
    : pendingAction?.type === 'switch'
      ? pendingRelocationFee
      : fp(0);

  const nextMonthlyOpex = pendingAction
    ? pendingAction.type === 'add'
      ? currentMonthlyOpex + (pendingPricing?.monthlyOpex ?? 0)
      : pendingAction.type === 'remove'
        ? Math.max(0, currentMonthlyOpex - (pendingPricing?.monthlyOpex ?? 0))
        : currentMonthlyOpex
    : currentMonthlyOpex;

  const canAfford = airline ? pendingCost <= airline.corporateBalance : false;

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
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center space-x-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span className="text-[10px] uppercase font-bold tracking-wider">Operations Centers (Hubs)</span>
              </div>
              <HubPicker currentHub={null} onSelect={handleAddHub} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <p className="text-[10px] uppercase font-bold text-muted-foreground">Monthly Hub OPEX</p>
                <p className="text-sm font-mono font-black text-foreground mt-1">
                  {fpFormat(fp(currentMonthlyOpex), 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <p className="text-[10px] uppercase font-bold text-muted-foreground">Next Hub Setup</p>
                <p className="text-sm font-mono font-black text-foreground mt-1">Tiered by airport</p>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <p className="text-[10px] uppercase font-bold text-muted-foreground">Relocation Fee</p>
                <p className="text-sm font-mono font-black text-foreground mt-1">25% of hub setup</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {airline.hubs.map((hub) => {
                const isActive = homeAirport?.iata === hub;
                const pricing = getHubPricingForIata(hub);
                return (
                  <div key={hub} className={`rounded-lg border p-4 flex items-center justify-between transition-all ${isActive ? 'bg-primary/5 border-primary/40' : 'bg-background/30 border-border/30 grayscale opacity-80'}`}>
                    <div className="flex items-center space-x-3">
                      <span className="font-mono text-xl font-black text-foreground">{hub}</span>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">{pricing.tier}</span>
                      {isActive && (
                        <span className="flex items-center text-[9px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> HQ Hub
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground">
                        OPEX {fpFormat(fp(pricing.monthlyOpex), 0)}/mo
                      </span>
                    </div>
                    {!isActive && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSwitchActiveHub(hub)}
                          className="text-[10px] font-bold uppercase text-muted-foreground hover:text-foreground hover:bg-white/5 border border-white/10 px-3 py-1.5 rounded transition-all"
                        >
                          Establish Here
                        </button>
                        <button
                          onClick={() => handleCloseHub(hub)}
                          disabled={airline.hubs.length <= 1}
                          className="text-[10px] font-bold uppercase text-rose-300/70 hover:text-rose-200 hover:bg-rose-500/10 border border-rose-400/20 px-3 py-1.5 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          title={airline.hubs.length <= 1 ? 'Cannot close last hub' : 'Close hub'}
                        >
                          Close Hub
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

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

        <div className="mt-8 mb-4 flex items-center space-x-2 text-muted-foreground px-1">
          <Landmark className="h-4 w-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Operational Audit Trail (Ledger)</span>
        </div>
        <div className="rounded-xl border border-border/50 bg-background/50 overflow-hidden">
          <AirlineTimeline />
        </div>

        <div className="mt-8 pt-8 pb-4 text-center">
          <p className="text-[10px] text-muted-foreground/30 font-mono tracking-widest uppercase italic border-t border-white/5 pt-4">
            Nostr Registered Identity • Verified Operations Ledger
          </p>
        </div>
      </div>
      {pendingAction && pendingPricing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setPendingAction(null)} />
          <div className="relative z-10 w-full max-w-xl rounded-2xl border border-white/10 bg-gradient-to-br from-[#0b1117] via-[#0d1218] to-[#101722] p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-white/40">Hub Contract Review</p>
                <h3 className="mt-2 text-2xl font-black text-white">{pendingAction.iata} • {pendingPricing.tier.toUpperCase()}</h3>
                <p className="mt-1 text-sm text-white/60">
                  {pendingAction.type === 'add' && 'Opening a new hub activates market access and starts monthly operations costs.'}
                  {pendingAction.type === 'switch' && 'Relocating your primary hub updates active operations with a relocation fee.'}
                  {pendingAction.type === 'remove' && 'Closing a hub stops monthly operations costs for that location.'}
                </p>
              </div>
              <button
                onClick={() => setPendingAction(null)}
                className="text-white/40 hover:text-white transition"
                aria-label="Close hub contract review"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-[10px] uppercase font-semibold text-white/40">Immediate Charge</p>
                <p className="mt-1 text-lg font-mono font-black text-white">
                  {fpFormat(pendingCost, 0)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-[10px] uppercase font-semibold text-white/40">New Monthly OPEX</p>
                <p className="mt-1 text-lg font-mono font-black text-white">
                  {fpFormat(fp(nextMonthlyOpex), 0)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-[10px] uppercase font-semibold text-white/40">Cash After</p>
                <p className={`mt-1 text-lg font-mono font-black ${canAfford ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {fpFormat(fpSub(airline.corporateBalance, pendingCost), 0)}
                </p>
              </div>
            </div>

            {actionError && (
              <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {actionError}
              </div>
            )}

            {!canAfford && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Insufficient liquidity for this hub action.
              </div>
            )}

            <div className="mt-6 flex items-center justify-between">
              <div className="text-[10px] uppercase text-white/40">
                Charges post immediately • Monthly OPEX bills every 30 days
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPendingAction(null)}
                  className="rounded-md border border-white/10 px-4 py-2 text-xs font-bold uppercase text-white/60 hover:text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmHubAction}
                  disabled={!canAfford || isProcessing}
                  className="rounded-md bg-emerald-500/90 px-5 py-2 text-xs font-bold uppercase text-black transition hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? 'Processing...' : 'Confirm & Charge'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PanelLayout>
  );
}
