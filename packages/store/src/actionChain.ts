import { computeActionChainHash, type GameActionEnvelope } from "@airtr/core";
import { type NDKEvent, publishAction } from "@airtr/nostr";
import type { AirlineState } from "./types";
import { enqueueSerialUpdate } from "./utils/asyncQueue";

export async function updateActionChainHashFromEvent(params: {
  action: GameActionEnvelope;
  event: NDKEvent;
  get: () => AirlineState;
  set: (state: Partial<AirlineState>) => void;
}): Promise<void> {
  const { action, event, get, set } = params;
  const currentHash = get().actionChainHash || "";
  const nextHash = await computeActionChainHash(currentHash, {
    id: event.id,
    createdAt: event.created_at ?? null,
    authorPubkey: event.author?.pubkey ?? "",
    action,
  });
  set({ actionChainHash: nextHash });
}

export async function publishActionWithChain(params: {
  action: GameActionEnvelope;
  get: () => AirlineState;
  set: (state: Partial<AirlineState>) => void;
}): Promise<NDKEvent> {
  const { action, get, set } = params;
  const event = await publishAction(action);
  await enqueueSerialUpdate(() => updateActionChainHashFromEvent({ action, event, get, set }));
  return event;
}
