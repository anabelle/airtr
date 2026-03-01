import { connectedRelayCount } from "@acars/nostr";
import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 5000;

export function useRelayHealth(): { isConnected: boolean; relayCount: number } {
  const [relayCount, setRelayCount] = useState(() => connectedRelayCount());

  useEffect(() => {
    const id = setInterval(() => {
      setRelayCount(connectedRelayCount());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return { relayCount, isConnected: relayCount > 0 };
}
