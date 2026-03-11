import { useAirlineStore } from "@acars/store";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AirlineCreator } from "./AirlineCreator";
import { SecurityUpgradeBanner } from "./SecurityUpgradeBanner";

export function IdentityGate({ children }: { children: React.ReactNode }) {
  const { identityStatus, airline, isEphemeral } = useAirlineStore();
  const { t } = useTranslation("identity");

  useEffect(() => {
    document.documentElement.dataset.appReady = identityStatus === "checking" ? "false" : "true";

    return () => {
      delete document.documentElement.dataset.appReady;
    };
  }, [identityStatus]);

  if (identityStatus === "checking") {
    return (
      <div className="flex h-full w-full items-center justify-center pointer-events-auto">
        <div className="flex flex-col items-center justify-center space-y-4 rounded-2xl border border-border/50 bg-background/60 p-8 shadow-2xl backdrop-blur-xl">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">
            {t("gate.connecting")}
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
      <div className="flex h-full w-full items-start justify-center overflow-auto px-4 py-24 sm:px-6 sm:py-12 pointer-events-auto backdrop-blur-[2px] bg-background/20">
        <AirlineCreator />
      </div>
    );
  }

  // Success — render the full app with optional security banner for ephemeral keys
  return (
    <div className="flex h-full w-full flex-col">
      {isEphemeral && <SecurityUpgradeBanner />}
      {children}
    </div>
  );
}
