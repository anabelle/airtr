const MAX_BADGE = 99;

function formatCount(count: number): string {
  return count > MAX_BADGE ? `${MAX_BADGE}+` : String(count);
}

interface NavBadgeProps {
  count: number;
  variant: "gray" | "red";
  /** Extra Tailwind classes for size/position overrides */
  className?: string;
}

/**
 * A small pill badge to overlay on nav icons.
 * Renders nothing when count <= 0.
 * Position: absolute, placed by the parent's `relative` wrapper.
 */
export function NavBadge({ count, variant, className = "" }: NavBadgeProps) {
  if (count <= 0) return null;

  const base =
    "absolute -top-1 -right-1 z-10 flex min-w-[16px] h-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none tabular-nums pointer-events-none";

  const colors =
    variant === "red"
      ? "bg-destructive text-white"
      : "bg-muted text-muted-foreground border border-border/60";

  return (
    <span
      className={`${base} ${colors} ${className}`}
      aria-label={`${count} notification${count !== 1 ? "s" : ""}`}
    >
      {formatCount(count)}
    </span>
  );
}
