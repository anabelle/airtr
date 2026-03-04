import { connectedRelayCount, reconnectIfNeeded } from "@acars/nostr";
import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 5000;
// Wait this many consecutive offline polls before attempting reconnect
const OFFLINE_THRESHOLD = 3;

export function useRelayHealth(): { isConnected: boolean; relayCount: number } {
  const [relayCount, setRelayCount] = useState(() => connectedRelayCount());
  const offlineCountRef = useRef(0);
  const reconnectingRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      const count = connectedRelayCount();
      setRelayCount(count);

      if (count === 0) {
        offlineCountRef.current += 1;
        // After ~15s offline, proactively try to reconnect
        if (offlineCountRef.current >= OFFLINE_THRESHOLD && !reconnectingRef.current) {
          reconnectingRef.current = true;
          reconnectIfNeeded().finally(() => {
            reconnectingRef.current = false;
            setRelayCount(connectedRelayCount());
          });
        }
      } else {
        offlineCountRef.current = 0;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return { relayCount, isConnected: relayCount > 0 };
}
