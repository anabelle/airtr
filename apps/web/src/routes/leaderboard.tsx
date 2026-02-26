import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/leaderboard')({
    component: lazyRouteComponent(() => import('./-leaderboard.lazy')),
});
