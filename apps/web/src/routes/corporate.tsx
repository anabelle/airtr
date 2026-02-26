import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/corporate')({
  component: lazyRouteComponent(() => import('./-corporate.lazy')),
});
