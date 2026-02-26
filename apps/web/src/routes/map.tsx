import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/map')({
  component: lazyRouteComponent(() => import('./-map.lazy')),
});
