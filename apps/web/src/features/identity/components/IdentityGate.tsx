import { useAirlineStore } from "@airtr/store";
import { Loader2 } from "lucide-react";
import { AirlineCreator } from "./AirlineCreator";

export function IdentityGate({ children }: { children: React.ReactNode }) {
  const { identityStatus, airline } = useAirlineStore();

  if (identityStatus === "checking") {
    return (
      <div className="flex h-full w-full items-center justify-center pointer-events-auto">
        <div className="flex flex-col items-center justify-center space-y-4 rounded-2xl border border-border/50 bg-background/60 p-8 shadow-2xl backdrop-blur-xl">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">
            Establishing secure connection to Nostr network...
          </p>
        </div>
      </div>
    );
  }

  if (identityStatus === "guest" || identityStatus === "no-extension") {
    return <>{children}</>;
  }

  // If we have an identity but no airline entity
  if (identityStatus === "ready" && !airline) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto p-4 py-12 pointer-events-auto backdrop-blur-[2px] bg-background/20">
        <AirlineCreator />
      </div>
    );
  }

  // Success
  return <>{children}</>;
}
