import Dexie, { type EntityTable } from "dexie";
import type { AirlineEntity, AircraftInstance, Route } from "@acars/core";
import { WORLD_ID } from "@acars/nostr/src/schema";

const DB_NAME = `AirTRDatabase-${WORLD_ID}`;

export const db = new Dexie(DB_NAME) as Dexie & {
  airline: EntityTable<AirlineEntity, "id">;
  fleet: EntityTable<AircraftInstance, "id">;
  routes: EntityTable<Route, "id">;
};

db.version(2).stores({
  airline: "id, ceoPubkey",
  fleet: "id, ownerPubkey, assignedRouteId",
  routes: "id, airlinePubkey, originIata, destinationIata",
});
