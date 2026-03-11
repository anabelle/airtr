import type { LucideIcon } from "lucide-react";
import { NostrAccessCard } from "@/shared/components/identity/NostrAccessCard";

type WorkspaceLockedStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  onConnect: () => void;
  onCreateFree?: () => void;
  onLoginWithNsec?: (nsec: string) => Promise<void>;
  isLoading?: boolean;
};

export function WorkspaceLockedState(props: WorkspaceLockedStateProps) {
  return (
    <div className="pointer-events-auto flex h-full w-full items-center justify-center px-3 py-6 pb-24 sm:px-6 sm:py-8 sm:pb-6">
      <NostrAccessCard {...props} />
    </div>
  );
}
