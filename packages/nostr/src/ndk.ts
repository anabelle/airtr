import { createLogger } from "@airtr/core";
import NDK from "@nostr-dev-kit/ndk";

const DEFAULT_RELAYS = [
  "wss://nostr.pixel.xx.kg", // Dedicated AirTR relay
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://offchain.pub",
  "wss://relay.nostr.net",
  "wss://relay.nos.social",
  "wss://nostr.land",
];

let ndkInstance: NDK | null = null;
let connectionPromise: Promise<void> | null = null;
const logger = createLogger("Nostr");

/**
 * Get (or create) the NDK singleton.
 */
export function getNDK(): NDK {
  if (!ndkInstance) {
    ndkInstance = new NDK({
      explicitRelayUrls: DEFAULT_RELAYS,
      initialValidationRatio: 1.0,
      lowestValidationRatio: 1.0,
    });
  }
  return ndkInstance;
}

/**
 * Returns the number of currently connected relays.
 */
export function connectedRelayCount(): number {
  const ndk = getNDK();
  try {
    return ndk.pool?.connectedRelays()?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Attempts to reconnect to relays if none are currently connected.
 * Returns true if at least one relay is connected after the attempt.
 */
export async function reconnectIfNeeded(): Promise<boolean> {
  const count = connectedRelayCount();
  if (count > 0) return true;

  logger.warn("No relays connected — attempting reconnection...");
  const ndk = getNDK();
  try {
    await ndk.connect(3000);
  } catch {
    logger.warn("Reconnection attempt timed out, NDK will keep trying in background.");
  }

  // Poll briefly for at least one relay to come up
  const start = Date.now();
  const MAX_WAIT = 5000;
  const POLL_INTERVAL = 250;
  while (connectedRelayCount() === 0 && Date.now() - start < MAX_WAIT) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  const newCount = connectedRelayCount();
  if (newCount > 0) {
    logger.info(`Reconnected to ${newCount} relay(s) after ${Date.now() - start}ms.`);
    return true;
  }

  logger.warn("Reconnection failed — still no relays connected.");
  return false;
}

/**
 * Ensures we are connected to at least one relay.
 *
 * The initial ndk.connect() call is made once; subsequent calls reuse the
 * same promise.  However, if the initial connect resolved before any relay
 * actually connected (timeout), later callers would get a resolved promise
 * while NDK is still connecting in the background.  To handle this, after
 * the initial connect we poll briefly for a connected relay so that the
 * first loadActionLog / loadCheckpoint call has a relay available.
 */
export async function ensureConnected(): Promise<void> {
  const ndk = getNDK();

  if (!connectionPromise) {
    connectionPromise = (async () => {
      logger.info("Connecting to relays:", DEFAULT_RELAYS.length);
      try {
        await ndk.connect(3000);
        logger.info("Initial connection attempt complete.");
      } catch {
        logger.warn(
          "Connection attempt timed out or failed, but NDK will keep trying in background.",
        );
      }
    })();
  }

  await connectionPromise;

  // If no relay is connected yet, wait up to 5s for at least one.
  // NDK continues connecting in the background after connect() resolves,
  // so we poll rather than re-calling connect().
  if (connectedRelayCount() === 0) {
    const start = Date.now();
    const MAX_WAIT = 5000;
    const POLL_INTERVAL = 250;
    while (connectedRelayCount() === 0 && Date.now() - start < MAX_WAIT) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
    const count = connectedRelayCount();
    if (count > 0) {
      logger.info(`Relay connected after ${Date.now() - start}ms (${count} relay(s)).`);
    } else {
      logger.warn(
        "No relays connected after extended wait. Subscriptions may return empty results.",
      );
    }
  }
}
