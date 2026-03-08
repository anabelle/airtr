import { useAirlineStore } from "@acars/store";
import { useNavigate } from "@tanstack/react-router";
import { Globe, Plane, TrendingUp, Users, Zap } from "lucide-react";
import { useEffect } from "react";
import { GuestKeyOnboarding } from "@/features/identity/components/GuestKeyOnboarding";

const features = [
  {
    icon: Plane,
    title: "Real-time flights",
    description:
      "Routes resolve in actual real-world time. A 7-hour transatlantic flight takes 7 real hours — check in anytime.",
  },
  {
    icon: TrendingUp,
    title: "Run a real corporation",
    description:
      "Issue stock, manage a cap table, file for IPO, weather bankruptcies, or launch a hostile takeover.",
  },
  {
    icon: Zap,
    title: "Earn real Bitcoin",
    description: "Play-to-earn prize pools and Lightning Zaps. Trade airline stock slots P2P.",
  },
  {
    icon: Globe,
    title: "Fully decentralized",
    description:
      "No servers, no central database. Your airline lives on the open Nostr network — you own it completely.",
  },
  {
    icon: Users,
    title: "Compete globally",
    description: "Thousands of airlines, live leaderboards, and a global route marketplace.",
  },
];

export default function JoinPage() {
  const identityStatus = useAirlineStore((state) => state.identityStatus);
  const airline = useAirlineStore((state) => state.airline);
  const navigate = useNavigate();

  // Redirect to app once identity + airline are ready
  useEffect(() => {
    if (identityStatus === "ready" && airline) {
      void navigate({ to: "/" });
    }
  }, [identityStatus, airline, navigate]);

  function handleExistingAccount() {
    void navigate({ to: "/" });
  }

  return (
    <div className="pointer-events-auto relative flex min-h-screen w-full flex-col overflow-auto bg-background/95 backdrop-blur-2xl">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border/60 bg-background/80 px-6 py-4 backdrop-blur-xl">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
          AT
        </div>
        <div>
          <h1 className="text-sm font-bold leading-none tracking-tight text-foreground">ACARS</h1>
          <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Aircraft Communication Addressing and Relay System
          </p>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-6 py-12">
        <section className="flex flex-col items-start gap-8 lg:flex-row lg:items-center">
          {/* Pitch */}
          <div className="flex-1 space-y-4">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Plane className="h-3 w-3" />
              Free to play · No account needed
            </div>
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
              Build the world&apos;s <br />
              most powerful airline.
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              An open-source, real-time airline tycoon where you own everything — your fleet, your
              routes, your data. No middlemen. No subscriptions.
            </p>
          </div>

          {/* Onboarding card */}
          <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background/60 p-6 shadow-2xl backdrop-blur-xl">
            <GuestKeyOnboarding onExistingAccount={handleExistingAccount} />
          </div>
        </section>

        {/* Feature grid */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex gap-3 rounded-xl border border-border/50 bg-background/50 p-4 backdrop-blur-sm"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{f.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {f.description}
                </p>
              </div>
            </div>
          ))}
        </section>

        {/* Footer note */}
        <p className="text-center text-[11px] text-muted-foreground/50">
          Open source · MIT License · Powered by the Nostr protocol
        </p>
      </main>
    </div>
  );
}
