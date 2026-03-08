import type { Airport } from "@acars/core";
import { fp, fpFormat } from "@acars/core";
import { getHubPricingForIata } from "@acars/data";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { CheckCircle2, KeyRound, PlaneTakeoff, ShieldAlert } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { HubPicker } from "../../network/components/HubPicker";
import { EphemeralKeyBackupActions } from "./EphemeralKeyBackupActions";
import { findAirlineConflicts } from "../utils/airlineConflicts";

export function AirlineCreator() {
  const { createAirline, identityStatus, isLoading, error, competitors } = useAirlineStore();
  const isEphemeral = useAirlineStore((state) => state.isEphemeral);
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const setHub = useEngineStore((s) => s.setHub);

  const [name, setName] = useState("");
  const [icao, setIcao] = useState("");
  const [callsign, setCallsign] = useState("");
  const [primary, setPrimary] = useState("#1a1a2e");
  const [secondary, setSecondary] = useState("#10b981"); // neon greenish accent
  const [showKeyTools, setShowKeyTools] = useState(false);

  const { nameConflict, icaoConflict } = useMemo(
    () => findAirlineConflicts(competitors, name, icao),
    [competitors, name, icao],
  );
  const hubPricing = homeAirport ? getHubPricingForIata(homeAirport.iata) : null;
  const normalizedIcao = icao.toUpperCase();
  const suggestedCallsign = callsign || (normalizedIcao ? `${normalizedIcao} HEAVY` : "APX HEAVY");

  const handleHubChange = (airport: Airport | null) => {
    if (!airport) return;
    setHub(
      airport,
      { latitude: airport.latitude, longitude: airport.longitude, source: "manual" },
      "manual selection",
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!homeAirport) return;

    try {
      await createAirline({
        name,
        icaoCode: normalizedIcao,
        callsign: suggestedCallsign,
        hubs: [homeAirport.iata],
        livery: {
          primary,
          secondary,
          accent: "#ffffff",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Airline creation failed", { description: message });
    }
  };

  if (
    identityStatus === "checking" ||
    identityStatus === "no-extension" ||
    identityStatus === "guest"
  ) {
    // This is handled by IdentityGate, but keeping safe returns just in case
    return null;
  }

  return (
    <div className="mx-auto my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card/80 shadow-2xl backdrop-blur-md">
      <div className="border-b border-border bg-muted px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Connected - create your airline
            </div>
            <h2 className="flex items-center text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              <PlaneTakeoff className="mr-3 h-6 w-6 text-primary" />
              Launch Your Airline
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Set up your home airport, name your airline, and pick your colors. You&apos;ll be
              flying in under a minute.
            </p>
          </div>
          {isEphemeral && (
            <button
              type="button"
              onClick={() => setShowKeyTools((open) => !open)}
              className="inline-flex items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-amber-200 transition hover:bg-amber-500/20"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {showKeyTools ? "Hide key tools" : "Account key"}
            </button>
          )}
        </div>
        {isEphemeral && showKeyTools && (
          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-950/30 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
              Local account key
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
              Export your recovery key before launch so this airline stays yours if you lose this
              browser.
            </p>
            <div className="mt-3">
              <EphemeralKeyBackupActions />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-4 sm:space-y-6 sm:p-8">
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start">
            <ShieldAlert className="h-5 w-5 text-destructive mr-3 mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Hub Selection */}
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Home Hub</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This is where your airline will be based. It determines your starting region and
              costs.
            </p>
          </div>

          {homeAirport ? (
            <div className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xl font-black tracking-tighter text-foreground">
                      {homeAirport.iata}
                    </span>
                    <span className="inline-flex items-center rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {homeAirport.country}
                    </span>
                  </div>
                  <p className="mt-1 font-medium leading-snug text-sm">{homeAirport.city}</p>
                  <p className="text-xs text-muted-foreground truncate">{homeAirport.name}</p>
                </div>
              </div>
              {hubPricing ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Tier
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground capitalize">
                      {hubPricing.tier}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Setup
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {fpFormat(fp(hubPricing.openFee), 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Monthly
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {fpFormat(fp(hubPricing.monthlyOpex), 0)}
                    </p>
                  </div>
                </div>
              ) : null}
              <HubPicker currentHub={homeAirport} onSelect={handleHubChange} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-background p-5">
              <div className="text-center space-y-3">
                <p className="text-sm font-medium text-foreground">
                  Finding your best starting hub…
                </p>
                <p className="text-xs text-muted-foreground">
                  We&apos;re using your location to suggest a nearby airport.
                </p>
                <HubPicker currentHub={null} onSelect={handleHubChange} />
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-border w-full" />

        {/* Corporate Identity */}
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Airline Identity</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose a name, a short code, and an optional callsign. Other players will see these on
              the map and leaderboards.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label
                htmlFor="airline-name"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Airline Name
              </label>
              <input
                id="airline-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Apex Global"
                className="flex h-10 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {nameConflict ? (
                <p className="text-xs text-destructive">
                  An airline named "{nameConflict}" already exists.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Keep it short, memorable, and easy to spot on the map.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label
                htmlFor="airline-icao"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                ICAO Code <span className="text-muted-foreground font-normal">(3 letters)</span>
              </label>
              <input
                id="airline-icao"
                required
                maxLength={3}
                value={icao}
                onChange={(e) => setIcao(e.target.value.replace(/[^a-z]/gi, "").toUpperCase())}
                placeholder="APX"
                className="flex h-10 w-full uppercase rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {icaoConflict ? (
                <p className="text-xs text-destructive">
                  ICAO code "{icaoConflict}" is already in use.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A unique 3-letter shortcode shown on routes and aircraft tails.
                </p>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <label
                htmlFor="airline-callsign"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Radio Callsign
              </label>
              <input
                id="airline-callsign"
                value={callsign}
                onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                placeholder={normalizedIcao ? `${normalizedIcao} HEAVY` : "APEX HEAVY"}
                className="flex h-10 w-full uppercase rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use{" "}
                <span className="font-semibold text-foreground">{suggestedCallsign}</span>.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Livery Colors</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                These two colors will appear on your aircraft and brand.
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 py-1">
              <span
                className="h-3.5 w-3.5 rounded-full border border-black/10"
                style={{ backgroundColor: primary }}
              />
              <span
                className="h-3.5 w-3.5 rounded-full border border-black/10"
                style={{ backgroundColor: secondary }}
              />
              <span className="text-[11px] font-medium text-muted-foreground">Preview</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background"
              />
              <span className="text-sm font-medium">Primary</span>
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background"
              />
              <span className="text-sm font-medium">Secondary</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Ready to Launch
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground">
            <span className="rounded-full bg-background px-3 py-1 font-semibold">
              {homeAirport?.iata ?? "Hub pending"}
            </span>
            <span className="rounded-full bg-background px-3 py-1 font-semibold">
              {normalizedIcao || "ICAO pending"}
            </span>
            <span className="rounded-full bg-background px-3 py-1 font-semibold">
              {suggestedCallsign}
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={
            isLoading ||
            !homeAirport ||
            !name ||
            !icao ||
            Boolean(nameConflict) ||
            Boolean(icaoConflict)
          }
          className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8"
        >
          {isLoading ? (
            "Launching airline..."
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Launch Airline
            </>
          )}
        </button>
      </form>
    </div>
  );
}
