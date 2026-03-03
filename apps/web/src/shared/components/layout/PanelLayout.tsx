import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";

export function PanelLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="relative flex h-full w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background/85 shadow-[0_0_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl duration-300 animate-in fade-in slide-in-from-left-4 pointer-events-auto">
      <button
        type="button"
        onClick={() => navigate({ to: "/" })}
        className="absolute right-6 top-8 z-50 rounded-md bg-background/50 p-1.5 text-muted-foreground shadow-sm backdrop-blur-md transition-all hover:bg-accent hover:text-foreground"
        title="Close Panel (View Map)"
      >
        <X className="h-4 w-4" />
      </button>
      {/* We need to push the content down so the absolute button doesn't hit the text */}
      <div className="flex h-full w-full min-h-0 flex-col pt-2">{children}</div>
    </div>
  );
}
