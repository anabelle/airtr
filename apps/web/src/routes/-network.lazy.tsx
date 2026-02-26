import { useAirlineStore } from "@airtr/store";
import { RouteManager } from "@/features/network/components/RouteManager";
import { PanelLayout } from "@/shared/components/layout/PanelLayout";

export default function NetworkPage() {
  const { airline, initializeIdentity, isLoading } = useAirlineStore();

  if (!airline) {
    return (
      <PanelLayout>
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="max-w-md space-y-4 rounded-2xl border border-border/60 bg-background/70 p-6 shadow-2xl backdrop-blur-xl">
            <h2 className="text-lg font-semibold">Network access locked</h2>
            <p className="text-sm text-muted-foreground">
              Connect a Nostr wallet to create an airline and open routes across the network.
            </p>
            <button
              type="button"
              onClick={initializeIdentity}
              disabled={isLoading}
              className="w-full rounded-md border border-border bg-background/70 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
            >
              {isLoading ? "Connecting..." : "Connect Wallet"}
            </button>
          </div>
        </div>
      </PanelLayout>
    );
  }

  return (
    <PanelLayout>
      <RouteManager />
    </PanelLayout>
  );
}
