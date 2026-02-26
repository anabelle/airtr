import { PanelLayout } from '@/shared/components/layout/PanelLayout';
import { RouteManager } from '@/features/network/components/RouteManager';

export default function NetworkPage() {
  return (
    <PanelLayout>
      <RouteManager />
    </PanelLayout>
  );
}
