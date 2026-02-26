import { PanelLayout } from '@/shared/components/layout/PanelLayout';
import { Leaderboard } from '@/features/competition/components/Leaderboard';

export default function LeaderboardPage() {
    return (
        <PanelLayout>
            <div className="flex h-full w-full flex-col p-6">
                <Leaderboard />
            </div>
        </PanelLayout>
    );
}
