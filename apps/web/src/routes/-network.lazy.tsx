import { useAirlineStore } from "@acars/store";
import { RouteManager } from "@/features/network/components/RouteManager";
import { NostrAccessCard } from "@/shared/components/identity/NostrAccessCard";
import { PanelLayout } from "@/shared/components/layout/PanelLayout";
import { Globe } from "lucide-react";

export default function NetworkPage() {
  const { airline, initializeIdentity, createNewIdentity, loginWithNsec, isLoading } =
    useAirlineStore();
  const isViewingOther = useAirlineStore((state) => Boolean(state.viewedPubkey));

  if (!airline && !isViewingOther) {
    return (
      <PanelLayout>
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
          <NostrAccessCard
            icon={Globe}
            title="Network access locked"
            description="Open routes after you connect a Nostr wallet and create your airline profile."
            onConnect={initializeIdentity}
            onCreateFree={createNewIdentity}
            onLoginWithNsec={loginWithNsec}
            isLoading={isLoading}
          />
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
