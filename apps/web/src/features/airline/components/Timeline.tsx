import { fpFormat, TICK_DURATION, TICKS_PER_HOUR, type TimelineEvent } from "@airtr/core";
import { useAirlineStore, useEngineStore } from "@airtr/store";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowRight,
  Clock,
  DollarSign,
  Hammer,
  MapPin,
  Package,
  PlaneLanding,
  PlaneTakeoff,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  UserMinus,
  Users,
} from "lucide-react";
import React from "react";

const EventIcon = ({ type }: { type: TimelineEvent["type"] }) => {
  switch (type) {
    case "takeoff":
      return <PlaneTakeoff className="w-4 h-4 text-sky-400" />;
    case "landing":
      return <PlaneLanding className="w-4 h-4 text-emerald-400" />;
    case "purchase":
      return <ShoppingBag className="w-4 h-4 text-orange-400" />;
    case "sale":
      return <DollarSign className="w-4 h-4 text-yellow-400" />;
    case "lease_payment":
      return <Clock className="w-4 h-4 text-rose-400" />;
    case "maintenance":
      return <Hammer className="w-4 h-4 text-purple-400" />;
    case "delivery":
      return <Package className="w-4 h-4 text-blue-400" />;
    case "hub_change":
      return <MapPin className="w-4 h-4 text-cyan-400" />;
    default:
      return <Package className="w-4 h-4 text-gray-400" />;
  }
};

const DetailRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div className="flex items-center justify-between py-1 border-b border-white/[0.03] last:border-0">
    <span className="text-[10px] text-white/40 uppercase font-semibold">{label}</span>
    <span className={`text-[10px] font-mono font-bold ${color || "text-white/60"}`}>{value}</span>
  </div>
);

const EventCard = ({ event }: { event: TimelineEvent }) => {
  const tick = useEngineStore((state) => state.tick);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const hasDetails = !!event.details;

  const getRelativeTime = (eventTick: number, currentTick: number) => {
    const diffSecs = Math.max(0, (currentTick - eventTick) * (TICK_DURATION / 1000));
    if (diffSecs < 10) return "Just now";
    if (diffSecs < 60) return `${Math.floor(diffSecs)}s ago`;
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    return `${Math.floor(diffSecs / 86400)}d ago`;
  };

  return (
    <div className="relative flex flex-col p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.1] transition-colors group">
      <div className="flex items-start gap-4">
        {/* Icon Node */}
        <div className="relative z-10 flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-black border border-white/10 group-hover:scale-110 transition-transform">
          <EventIcon type={event.type} />
        </div>

        {/* Content */}
        <div className="flex-grow min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-white/40">
              {event.type.replace("_", " ")}
            </span>
            <span className="text-[10px] font-mono text-white/20">
              {getRelativeTime(event.tick, tick)}
            </span>
          </div>

          <p className="text-sm text-white/80 leading-relaxed font-medium">{event.description}</p>

          {/* Details Row */}
          {(event.originIata || event.revenue || event.cost) && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {event.originIata && (
                <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold text-white/60">
                  {event.originIata}
                  <ArrowRight className="w-3 h-3 opacity-40" />
                  {event.destinationIata}
                </div>
              )}

              {event.revenue && (
                <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                  <TrendingUp className="w-3 h-3" />
                  {fpFormat(event.revenue, 0)}
                </div>
              )}

              {event.cost && (
                <div className="flex items-center gap-1 text-[10px] font-bold text-rose-400">
                  <TrendingDown className="w-3 h-3" />-{fpFormat(event.cost, 0)}
                </div>
              )}

              {event.profit !== undefined && (
                <div
                  className={`flex items-center gap-1 text-[10px] font-bold ${event.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                >
                  Net: {fpFormat(event.profit, 0)}
                </div>
              )}

              {hasDetails && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="ml-auto text-[10px] font-bold uppercase tracking-widest text-primary hover:text-primary-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  {isExpanded ? "Hide Details" : "View Breakdown"}
                </button>
              )}
            </div>
          )}

          {/* Passenger & Occupancy Summary (landing events only) */}
          {event.type === "landing" && event.details?.passengers && (
            <div className="mt-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              {/* Load Factor Bar */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                    Occupancy
                  </span>
                </div>
                <span
                  className={`text-xs font-mono font-black ${
                    (event.details.loadFactor ?? 0) >= 0.85
                      ? "text-emerald-400"
                      : (event.details.loadFactor ?? 0) >= 0.6
                        ? "text-yellow-400"
                        : "text-rose-400"
                  }`}
                >
                  {Math.round((event.details.loadFactor ?? 0) * 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    (event.details.loadFactor ?? 0) >= 0.85
                      ? "bg-emerald-500"
                      : (event.details.loadFactor ?? 0) >= 0.6
                        ? "bg-yellow-500"
                        : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.round((event.details.loadFactor ?? 0) * 100)}%` }}
                />
              </div>

              {/* Passenger Breakdown by Class */}
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="flex flex-col items-center p-2 rounded-lg bg-white/[0.03]">
                  <span className="text-[9px] uppercase font-bold text-white/30 tracking-widest mb-1">
                    Economy
                  </span>
                  <span className="text-sm font-mono font-black text-white/80">
                    {event.details.passengers.economy}
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-white/[0.03]">
                  <span className="text-[9px] uppercase font-bold text-amber-400/60 tracking-widest mb-1">
                    Business
                  </span>
                  <span className="text-sm font-mono font-black text-amber-400">
                    {event.details.passengers.business}
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-white/[0.03]">
                  <span className="text-[9px] uppercase font-bold text-violet-400/60 tracking-widest mb-1">
                    First
                  </span>
                  <span className="text-sm font-mono font-black text-violet-400">
                    {event.details.passengers.first}
                  </span>
                </div>
              </div>

              {/* Summary Row: Total pax, seats, spilled, duration */}
              <div className="flex items-center justify-between text-[10px] text-white/40">
                <span className="font-mono">
                  <span className="text-white/70 font-bold">{event.details.passengers.total}</span>/
                  {event.details.seatsOffered ?? "?"} seats
                </span>

                {(event.details.spilledPassengers ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-orange-400 font-bold">
                    <UserMinus className="w-3 h-3" />
                    {event.details.spilledPassengers} denied
                  </span>
                )}

                {event.details.flightDurationTicks && (
                  <span className="flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" />
                    {(event.details.flightDurationTicks / TICKS_PER_HOUR).toFixed(1)}h
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Details */}
      {isExpanded && event.details && (
        <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-1 duration-200">
          {event.details.revenue && (
            <div className="space-y-1">
              <p className="text-[9px] uppercase font-bold text-white/20 mb-2 tracking-widest">
                Revenue Breakdown
              </p>
              <DetailRow
                label="Tickets"
                value={fpFormat(event.details.revenue.tickets, 0)}
                color="text-emerald-400"
              />
              <DetailRow
                label="Ancillary"
                value={fpFormat(event.details.revenue.ancillary, 0)}
                color="text-emerald-400"
              />
              <div className="pt-2">
                <DetailRow
                  label="Total Revenue"
                  value={fpFormat(event.revenue!, 0)}
                  color="text-emerald-500"
                />
              </div>
            </div>
          )}
          {event.details.costs && (
            <div className="space-y-1">
              <p className="text-[9px] uppercase font-bold text-white/20 mb-2 tracking-widest">
                Operating Costs
              </p>
              <DetailRow
                label="Fuel Burn"
                value={fpFormat(event.details.costs.fuel, 0)}
                color="text-rose-400"
              />
              <DetailRow
                label="Crew Wages"
                value={fpFormat(event.details.costs.crew, 0)}
                color="text-rose-400"
              />
              <DetailRow
                label="Maintenance"
                value={fpFormat(event.details.costs.maintenance, 0)}
                color="text-rose-400"
              />
              <DetailRow
                label="Airport Fees"
                value={fpFormat(event.details.costs.airport, 0)}
                color="text-rose-400"
              />
              <DetailRow
                label="Navigation"
                value={fpFormat(event.details.costs.navigation, 0)}
                color="text-rose-400"
              />
              <DetailRow
                label="Leasing"
                value={fpFormat(event.details.costs.leasing, 0)}
                color="text-rose-400"
              />
              <DetailRow
                label="Overhead"
                value={fpFormat(event.details.costs.overhead, 0)}
                color="text-rose-400"
              />
              <div className="pt-2">
                <DetailRow
                  label="Total Costs"
                  value={fpFormat(event.cost!, 0)}
                  color="text-rose-500"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const AirlineTimeline: React.FC = () => {
  const timeline = useAirlineStore((state) => state.timeline);
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: timeline.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 6,
  });

  if (!timeline || timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center opacity-40">
        <Clock className="w-12 h-12 mb-4" />
        <p className="text-lg font-medium">No events recorded yet.</p>
        <p className="text-sm">Your airline's history will appear here as it grows.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent mb-6">
        Operations Ledger
      </h2>

      <div ref={parentRef} className="relative max-h-[60vh] overflow-y-auto pr-2">
        {/* Vertical Line */}
        <div className="absolute left-[1.125rem] top-2 bottom-2 w-px bg-white/5" />
        <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const event = timeline[virtualItem.index];
            if (!event) return null;
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 right-0 pb-3"
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <EventCard event={event} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
