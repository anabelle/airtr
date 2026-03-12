import { useAirlineStore } from "@acars/store";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RouteManager } from "@/features/network/components/RouteManager";
import { WorkspaceLockedState } from "@/shared/components/identity/WorkspaceLockedState";
import { PanelLayout } from "@/shared/components/layout/PanelLayout";

export default function NetworkPage() {
  const { t } = useTranslation("identity");
  const { airline, initializeIdentity, createNewIdentity, loginWithNsec, isLoading } =
    useAirlineStore();
  const isViewingOther = useAirlineStore((state) => Boolean(state.viewedPubkey));

  if (!airline && !isViewingOther) {
    return (
      <PanelLayout>
        <WorkspaceLockedState
          icon={Globe}
          title={t("access.networkLockedTitle")}
          description={t("access.networkLockedDescription")}
          onConnect={initializeIdentity}
          onCreateFree={createNewIdentity}
          onLoginWithNsec={loginWithNsec}
          isLoading={isLoading}
        />
      </PanelLayout>
    );
  }

  return (
    <PanelLayout>
      <RouteManager />
    </PanelLayout>
  );
}
