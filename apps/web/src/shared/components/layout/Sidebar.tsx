import { useAirlineStore } from "@acars/store";
import { Link } from "@tanstack/react-router";
import { Building2, Globe, Info, Map as MapIcon, Plane, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavBadges } from "@/shared/hooks/useNavBadges";
import { NavBadge } from "./NavBadge";

type NavItem = {
  icon: typeof MapIcon;
  labelKey: string;
  mobileLabelKey: string;
  to: string;
  requiresAirline: boolean;
};

const navItems: NavItem[] = [
  {
    icon: MapIcon,
    labelKey: "nav.map",
    mobileLabelKey: "nav.map",
    to: "/",
    requiresAirline: false,
  },
  {
    icon: Plane,
    labelKey: "nav.fleet",
    mobileLabelKey: "nav.fleet",
    to: "/fleet",
    requiresAirline: true,
  },
  {
    icon: Globe,
    labelKey: "nav.network",
    mobileLabelKey: "nav.mobileNet",
    to: "/network",
    requiresAirline: false,
  },
  {
    icon: Trophy,
    labelKey: "nav.leaderboard",
    mobileLabelKey: "nav.mobileRank",
    to: "/leaderboard",
    requiresAirline: false,
  },
  {
    icon: Building2,
    labelKey: "nav.corporate",
    mobileLabelKey: "nav.mobileCorp",
    to: "/corporate",
    requiresAirline: true,
  },
];

/** Resolve the badge to show for a given nav route path, given current badge counts. */
function resolveNavBadge(
  to: string,
  badges: ReturnType<typeof useNavBadges>,
): { count: number; variant: "gray" | "red" } | null {
  if (to === "/fleet") {
    if (badges.fleetUnassigned > 0) return { count: badges.fleetUnassigned, variant: "red" };
    if (badges.fleetTotal > 0) return { count: badges.fleetTotal, variant: "gray" };
    return null;
  }
  if (to === "/network") {
    if (badges.networkUnassigned > 0) return { count: badges.networkUnassigned, variant: "red" };
    if (badges.networkTotal > 0) return { count: badges.networkTotal, variant: "gray" };
    return null;
  }
  if (to === "/leaderboard") {
    if (badges.leaderboardRank > 0) return { count: badges.leaderboardRank, variant: "gray" };
    return null;
  }
  return null;
}

export function Sidebar() {
  const { airline, viewedPubkey } = useAirlineStore((state) => state);
  const hasAirlineContext = Boolean(airline || viewedPubkey);
  const badges = useNavBadges();
  const { t } = useTranslation("common");

  return (
    <div className="pointer-events-auto hidden sm:flex h-full w-16 md:w-20 flex-col items-center border-r border-border bg-background/80 py-6 backdrop-blur-xl transition-all">
      <div className="flex flex-1 flex-col space-y-4">
        {navItems.map((item) => {
          const isDisabled = item.requiresAirline && !hasAirlineContext;
          const badge = resolveNavBadge(item.to, badges);
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
              {badge && <NavBadge count={badge.count} variant={badge.variant} />}
              {/* Tooltip on hover */}
              <span className="absolute left-14 z-50 rounded-md bg-popover px-2 py-1 text-xs font-semibold text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 pointer-events-none whitespace-nowrap">
                {t(item.labelKey)}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col space-y-4">
        <Link
          to="/about"
          className="group relative flex h-12 w-12 items-center justify-center rounded-xl transition-all"
          activeProps={{
            className: "bg-primary/20 text-primary shadow-[inset_0_0_15px_rgba(16,185,129,0.2)]",
          }}
          inactiveProps={{
            className: "text-muted-foreground hover:bg-muted hover:text-foreground",
          }}
        >
          <Info className="h-6 w-6" />
          <span className="absolute left-14 z-50 rounded-md bg-popover px-2 py-1 text-xs font-semibold text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 pointer-events-none whitespace-nowrap">
            {t("nav.about")}
          </span>
        </Link>
      </div>
    </div>
  );
}

export function MobileNav() {
  const { airline, viewedPubkey } = useAirlineStore((state) => state);
  const hasAirlineContext = Boolean(airline || viewedPubkey);
  const badges = useNavBadges();
  const { t } = useTranslation("common");

  return (
    <nav className="pointer-events-auto grid shrink-0 grid-cols-6 items-stretch border-t border-border bg-background/90 px-2 py-1.5 backdrop-blur-xl pb-[calc(0.375rem+env(safe-area-inset-bottom))] sm:hidden">
      {navItems.map((item) => {
        const isDisabled = item.requiresAirline && !hasAirlineContext;
        const badge = resolveNavBadge(item.to, badges);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`flex min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 transition-all ${isDisabled ? "pointer-events-none opacity-40" : ""}`}
            activeProps={{
              className: "text-primary",
            }}
            inactiveProps={{
              className: isDisabled
                ? "text-muted-foreground"
                : "text-muted-foreground active:text-foreground",
            }}
          >
            <span className="relative">
              <item.icon className="h-5 w-5" />
              {badge && (
                <NavBadge
                  count={badge.count}
                  variant={badge.variant}
                  className="min-w-[14px] h-3.5 text-[8px]"
                />
              )}
            </span>
            <span className="text-center text-[8px] font-semibold uppercase tracking-[0.12em] leading-none">
              {t(item.mobileLabelKey)}
            </span>
          </Link>
        );
      })}
      <Link
        to="/about"
        className="flex min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 transition-all"
        activeProps={{
          className: "text-primary",
        }}
        inactiveProps={{
          className: "text-muted-foreground active:text-foreground",
        }}
      >
        <span className="relative">
          <Info className="h-5 w-5" />
        </span>
        <span className="text-center text-[8px] font-semibold uppercase tracking-[0.12em] leading-none">
          {t("nav.info")}
        </span>
      </Link>
    </nav>
  );
}
