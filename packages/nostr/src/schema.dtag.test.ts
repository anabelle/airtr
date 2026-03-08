import { describe, expect, it } from "vitest";
import { buildActionDTag, CATALOG_IMAGE_D_PREFIX } from "./schema.js";

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

    expect(createTag).toBe("airtr:world:v6-beta:action:airline_create");
    expect(tickTag).toBe("airtr:world:v6-beta:action:tick_update");
  });

  it("keeps action-only d-tags for airline create and tick update even with seq", () => {
    const createTag = buildActionDTag(
      { schemaVersion: 2, action: "AIRLINE_CREATE", payload: { tick: 42 } },
      5,
    );
    const tickTag = buildActionDTag(
      { schemaVersion: 2, action: "TICK_UPDATE", payload: { tick: 99 } },
      10,
    );

    // seq is ignored for singleton actions
    expect(createTag).toBe("airtr:world:v6-beta:action:airline_create");
    expect(tickTag).toBe("airtr:world:v6-beta:action:tick_update");
  });

  it("adds entity id and tick for route actions", () => {
    const tag = buildActionDTag({
      schemaVersion: 2,
      action: "ROUTE_OPEN",
      payload: { routeId: "rt-123", tick: 100 },
    });

    expect(tag).toBe("airtr:world:v6-beta:action:route_open:rt-123:100");
  });

  it("adds entity id, tick, and seq for route actions when seq is provided", () => {
    const tag = buildActionDTag(
      {
        schemaVersion: 2,
        action: "ROUTE_OPEN",
        payload: { routeId: "rt-123", tick: 100 },
      },
      7,
    );

    expect(tag).toBe("airtr:world:v6-beta:action:route_open:rt-123:100:s7");
  });

  it("adds entity id and tick for aircraft actions", () => {
    const tag = buildActionDTag({
      schemaVersion: 2,
      action: "AIRCRAFT_PURCHASE",
      payload: { instanceId: "ac-777", tick: 555 },
    });

    expect(tag).toBe("airtr:world:v6-beta:action:aircraft_purchase:ac-777:555");
  });

  it("adds entity id, tick, and seq for aircraft actions when seq is provided", () => {
    const tag = buildActionDTag(
      {
        schemaVersion: 2,
        action: "AIRCRAFT_PURCHASE",
        payload: { instanceId: "ac-777", tick: 555 },
      },
      42,
    );

    expect(tag).toBe("airtr:world:v6-beta:action:aircraft_purchase:ac-777:555:s42");
  });

  it("returns base tag when no identifiers are present", () => {
    const tag = buildActionDTag({
      schemaVersion: 2,
      action: "HUB_ADD",
      payload: {},
    });

    expect(tag).toBe("airtr:world:v6-beta:action:hub_add");
  });

  it("returns base tag with only seq when no identifiers are present but seq is provided", () => {
    const tag = buildActionDTag({ schemaVersion: 2, action: "HUB_ADD", payload: {} }, 3);

    expect(tag).toBe("airtr:world:v6-beta:action:hub_add:s3");
  });

  it("ensures different seq values produce different d-tags for same action", () => {
    const payload = { routeId: "rt-abc", tick: 200 };
    const tag1 = buildActionDTag({ schemaVersion: 2, action: "ROUTE_UPDATE_FARES", payload }, 0);
    const tag2 = buildActionDTag({ schemaVersion: 2, action: "ROUTE_UPDATE_FARES", payload }, 1);

    expect(tag1).not.toBe(tag2);
    expect(tag1).toBe("airtr:world:v6-beta:action:route_update_fares:rt-abc:200:s0");
    expect(tag2).toBe("airtr:world:v6-beta:action:route_update_fares:rt-abc:200:s1");
  });

  it("omits seq suffix when seq is undefined", () => {
    const withoutSeq = buildActionDTag({
      schemaVersion: 2,
      action: "ROUTE_ASSIGN_AIRCRAFT",
      payload: { aircraftId: "ac-1", routeId: "rt-1", tick: 50 },
    });

    // Without seq, the d-tag should be the same as before (backward compatible)
    expect(withoutSeq).toBe("airtr:world:v6-beta:action:route_assign_aircraft:rt-1:50");
  });
});

describe("catalog image d-tags", () => {
  it("uses a stable model-scoped d-tag prefix", () => {
    expect(CATALOG_IMAGE_D_PREFIX).toBe("airtr:world:v6-beta:catalog-image:");
  });
});
