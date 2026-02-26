import { describe, expect, it } from "vitest";
import { buildActionDTag } from "./schema.js";

describe("buildActionDTag", () => {
  it("keeps action-only d-tags for airline create and tick update", () => {
    const createTag = buildActionDTag({
      schemaVersion: 2,
      action: "AIRLINE_CREATE",
      payload: { tick: 42 },
    });
    const tickTag = buildActionDTag({
      schemaVersion: 2,
      action: "TICK_UPDATE",
      payload: { tick: 99 },
    });

    expect(createTag).toBe("airtr:world:dev-v3:action:airline_create");
    expect(tickTag).toBe("airtr:world:dev-v3:action:tick_update");
  });

  it("adds entity id and tick for route actions", () => {
    const tag = buildActionDTag({
      schemaVersion: 2,
      action: "ROUTE_OPEN",
      payload: { routeId: "rt-123", tick: 100 },
    });

    expect(tag).toBe("airtr:world:dev-v3:action:route_open:rt-123:100");
  });

  it("adds entity id and tick for aircraft actions", () => {
    const tag = buildActionDTag({
      schemaVersion: 2,
      action: "AIRCRAFT_PURCHASE",
      payload: { instanceId: "ac-777", tick: 555 },
    });

    expect(tag).toBe("airtr:world:dev-v3:action:aircraft_purchase:ac-777:555");
  });

  it("returns base tag when no identifiers are present", () => {
    const tag = buildActionDTag({
      schemaVersion: 2,
      action: "HUB_ADD",
      payload: {},
    });

    expect(tag).toBe("airtr:world:dev-v3:action:hub_add");
  });
});
