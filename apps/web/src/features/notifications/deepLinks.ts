export type NotificationDeepLinkTarget =
  | { kind: "corporate"; section?: "notifications" | "activity" | "financials" }
  | {
      kind: "network";
      tab?: "active" | "opportunities";
      routeFocus?: { originIata: string; destinationIata: string };
    }
  | { kind: "fleet" }
  | { kind: "airport"; iata: string; tab?: "info" | "flights" }
  | { kind: "aircraft"; id: string; tab?: "info" | "route" };

const isKnownPath = (pathname: string) =>
  pathname === "/corporate" ||
  pathname === "/network" ||
  pathname === "/fleet" ||
  /^\/airport\/[A-Z]{3}$/i.test(pathname) ||
  /^\/aircraft\/[A-Za-z0-9_-]+$/i.test(pathname);

export function buildNotificationUrl(target: NotificationDeepLinkTarget): string {
  switch (target.kind) {
    case "corporate": {
      const hash = target.section === "notifications" ? "#notifications" : "";
      return `/corporate${hash}`;
    }
    case "network": {
      const params = new URLSearchParams();
      if (target.tab) params.set("tab", target.tab);
      if (target.routeFocus) {
        params.set("origin", target.routeFocus.originIata);
        params.set("destination", target.routeFocus.destinationIata);
      }
      const query = params.toString();
      return `/network${query ? `?${query}` : ""}`;
    }
    case "fleet":
      return "/fleet";
    case "airport": {
      const params = new URLSearchParams();
      if (target.tab) params.set("airportTab", target.tab);
      const query = params.toString();
      return `/airport/${target.iata.toUpperCase()}${query ? `?${query}` : ""}`;
    }
    case "aircraft": {
      const params = new URLSearchParams();
      if (target.tab) params.set("aircraftTab", target.tab);
      const query = params.toString();
      return `/aircraft/${encodeURIComponent(target.id)}${query ? `?${query}` : ""}`;
    }
  }
}

export function parseNotificationUrl(
  input: string,
  origin = "https://acars.pub",
): NotificationDeepLinkTarget | null {
  try {
    const parsed = new URL(input, origin);
    if (parsed.origin !== new URL(origin).origin || !isKnownPath(parsed.pathname)) {
      return null;
    }

    if (parsed.pathname === "/corporate") {
      return {
        kind: "corporate",
        section: parsed.hash === "#notifications" ? "notifications" : undefined,
      };
    }

    if (parsed.pathname === "/network") {
      const originIata = parsed.searchParams.get("origin");
      const destinationIata = parsed.searchParams.get("destination");
      return {
        kind: "network",
        tab:
          parsed.searchParams.get("tab") === "opportunities"
            ? "opportunities"
            : parsed.searchParams.get("tab") === "active"
              ? "active"
              : undefined,
        routeFocus:
          originIata && destinationIata
            ? {
                originIata: originIata.toUpperCase(),
                destinationIata: destinationIata.toUpperCase(),
              }
            : undefined,
      };
    }

    if (parsed.pathname === "/fleet") {
      return { kind: "fleet" };
    }

    if (parsed.pathname.startsWith("/airport/")) {
      const iata = parsed.pathname.split("/")[2];
      return {
        kind: "airport",
        iata: iata.toUpperCase(),
        tab:
          parsed.searchParams.get("airportTab") === "flights"
            ? "flights"
            : parsed.searchParams.get("airportTab") === "info"
              ? "info"
              : undefined,
      };
    }

    if (parsed.pathname.startsWith("/aircraft/")) {
      return {
        kind: "aircraft",
        id: decodeURIComponent(parsed.pathname.split("/")[2]),
        tab:
          parsed.searchParams.get("aircraftTab") === "route"
            ? "route"
            : parsed.searchParams.get("aircraftTab") === "info"
              ? "info"
              : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function openNotificationUrl(input: string): void {
  if (typeof window === "undefined") return;
  const target = parseNotificationUrl(input, window.location.origin);
  if (!target) return;
  const url = buildNotificationUrl(target);
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
