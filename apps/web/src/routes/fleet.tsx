import { createFileRoute } from '@tanstack/react-router';
import { lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/fleet')({
  component: lazyRouteComponent(() => import('./-fleet.lazy')),
});
