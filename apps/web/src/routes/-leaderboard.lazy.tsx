import { Leaderboard } from "@/features/competition/components/Leaderboard";
import { PanelBody, PanelHeader, PanelLayout } from "@/shared/components/layout/PanelLayout";
import { useTranslation } from "react-i18next";

export default function LeaderboardPage() {
  const { t } = useTranslation("game");

  return (
    <PanelLayout>
      <PanelHeader title={t("leaderboard.pageTitle")} subtitle={t("leaderboard.pageSubtitle")} />
      <PanelBody className="pt-3 sm:pt-4">
        <Leaderboard />
      </PanelBody>
    </PanelLayout>
  );
}
