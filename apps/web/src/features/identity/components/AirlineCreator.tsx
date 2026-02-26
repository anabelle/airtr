import type { Airport } from "@airtr/core";
import { fp, fpFormat } from "@airtr/core";
import { getHubPricingForIata } from "@airtr/data";
import { useAirlineStore, useEngineStore } from "@airtr/store";
import { CheckCircle2, PlaneTakeoff, ShieldAlert } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { HubPicker } from "../../network/components/HubPicker";
import { findAirlineConflicts } from "../utils/airlineConflicts";

export function AirlineCreator() {
  const { createAirline, identityStatus, isLoading, error, competitors } = useAirlineStore();
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const setHub = useEngineStore((s) => s.setHub);

  const [name, setName] = useState("");
  const [icao, setIcao] = useState("");
  const [callsign, setCallsign] = useState("");
  const [primary, setPrimary] = useState("#1a1a2e");
  const [secondary, setSecondary] = useState("#10b981"); // neon greenish accent

  const { nameConflict, icaoConflict } = useMemo(
    () => findAirlineConflicts(competitors, name, icao),
    [competitors, name, icao],
  );

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
        icaoCode: icao.toUpperCase(),
        callsign: callsign || icao.toUpperCase() + " HEAVY",
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

  if (identityStatus === "checking" || identityStatus === "no-extension") {
    // This is handled by IdentityGate, but keeping safe returns just in case
    return null;
  }

  return (
    <div className="w-full max-w-2xl mx-auto backdrop-blur-md bg-card/80 border border-border shadow-2xl rounded-2xl overflow-hidden">
      <div className="bg-muted px-8 py-6 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center">
            <PlaneTakeoff className="mr-3 h-6 w-6 text-primary" />
            Found Corporate Entity
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Establish your global airline identity on the Nostr network.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-8 space-y-8">
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start">
            <ShieldAlert className="h-5 w-5 text-destructive mr-3 mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Hub Selection */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold tracking-tight">Primary Hub</h3>
            <HubPicker currentHub={homeAirport} onSelect={handleHubChange} />
          </div>

          {homeAirport ? (
            <div className="p-4 border border-border bg-background rounded-xl flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-3">
                  <span className="text-3xl font-black tracking-tighter text-foreground">
                    {homeAirport.iata}
                  </span>
                  <div>
                    <p className="font-medium leading-none">{homeAirport.city}</p>
                    <p className="text-sm text-muted-foreground mt-1">{homeAirport.name}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="font-bold">
                    Tier {getHubPricingForIata(homeAirport.iata).tier}
                  </span>
                  <span className="opacity-40">•</span>
                  <span>
                    Setup {fpFormat(fp(getHubPricingForIata(homeAirport.iata).openFee), 0)}
                  </span>
                  <span className="opacity-40">•</span>
                  <span>
                    OPEX {fpFormat(fp(getHubPricingForIata(homeAirport.iata).monthlyOpex), 0)}/mo
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary">
                  {homeAirport.country}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 border border-border bg-background rounded-xl flex items-center justify-center animate-pulse h-24">
              <span className="text-sm text-muted-foreground">
                Triangulating global position...
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Your hub determines your initial routes and regional dominance. Choose strategically.
          </p>
        </div>

        <div className="h-px bg-border w-full" />

        {/* Corporate Identity */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold tracking-tight">Corporate Branding</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Company Name
              </label>
              <input
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
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                ICAO Code <span className="text-muted-foreground font-normal">(3 Letters)</span>
              </label>
              <input
                required
                maxLength={3}
                value={icao}
                onChange={(e) => setIcao(e.target.value)}
                placeholder="APX"
                className="flex h-10 w-full uppercase rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {icaoConflict ? (
                <p className="text-xs text-destructive">
                  ICAO code "{icaoConflict}" is already in use.
                </p>
              ) : null}
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Radio Callsign
              </label>
              <input
                value={callsign}
                onChange={(e) => setCallsign(e.target.value)}
                placeholder={icao ? `${icao.toUpperCase()} HEAVY` : "APEX HEAVY"}
                className="flex h-10 w-full uppercase rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground">Livery Colors</h3>
          <div className="flex space-x-6">
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
            "Publishing to Nostr..."
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Establish Corporation
            </>
          )}
        </button>
      </form>
    </div>
  );
}
