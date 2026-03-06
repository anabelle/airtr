import Dexie, { type EntityTable } from "dexie";
import type { AirlineEntity, AircraftInstance, Route } from "@acars/core";

export const db = new Dexie("AirTRDatabase") as Dexie & {
  airline: EntityTable<AirlineEntity, "id">;
  fleet: EntityTable<AircraftInstance, "id">;
  routes: EntityTable<Route, "id">;
};

db.version(2).stores({
  airline: "id, ceoPubkey",
  fleet: "id, ownerPubkey, assignedRouteId",
  routes: "id, airlinePubkey, originIata, destinationIata",
});
