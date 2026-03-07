import { Leaderboard } from "@/features/competition/components/Leaderboard";
import { PanelBody, PanelHeader, PanelLayout } from "@/shared/components/layout/PanelLayout";

export default function LeaderboardPage() {
  return (
    <PanelLayout>
      <PanelHeader title="Leaderboard" subtitle="Multiplayer standings across the active world." />
      <PanelBody className="pt-3 sm:pt-4">
        <Leaderboard />
      </PanelBody>
    </PanelLayout>
  );
}
