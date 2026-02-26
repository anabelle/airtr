import { useAirlineStore } from "@airtr/store";
import { Link } from "@tanstack/react-router";
import { Building2, Globe, Map as MapIcon, Plane, Trophy } from "lucide-react";

const navItems = [
  { icon: MapIcon, label: "Map", to: "/", requiresAirline: false },
  { icon: Plane, label: "Fleet", to: "/fleet", requiresAirline: true },
  { icon: Globe, label: "Network", to: "/network", requiresAirline: false },
  { icon: Trophy, label: "Leaderboard", to: "/leaderboard", requiresAirline: false },
  { icon: Building2, label: "Corporate", to: "/corporate", requiresAirline: true },
];

export function Sidebar() {
  const { airline, viewedPubkey } = useAirlineStore((state) => state);
  const hasAirlineContext = Boolean(airline || viewedPubkey);

  return (
    <div className="pointer-events-auto flex h-full w-16 md:w-20 flex-col items-center border-r border-border bg-background/80 py-6 backdrop-blur-xl transition-all">
      <div className="flex flex-1 flex-col space-y-4">
        {navItems.map((item) => {
          const isDisabled = item.requiresAirline && !hasAirlineContext;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`group relative flex h-12 w-12 items-center justify-center rounded-xl transition-all ${isDisabled ? "pointer-events-none opacity-40" : ""}`}
              activeProps={{
                className:
                  "bg-primary/20 text-primary shadow-[inset_0_0_15px_rgba(16,185,129,0.2)]",
              }}
              inactiveProps={{
                className: isDisabled
                  ? "text-muted-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              }}
            >
              <item.icon className="h-6 w-6" />
              {/* Tooltip on hover */}
              <span className="absolute left-14 z-50 rounded-md bg-popover px-2 py-1 text-xs font-semibold text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 pointer-events-none whitespace-nowrap">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col space-y-4">{/* Future status or settings icons here */}</div>
    </div>
  );
}
