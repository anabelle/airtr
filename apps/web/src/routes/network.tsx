import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/network')({
  component: lazyRouteComponent(() => import('./-network.lazy')),
});
