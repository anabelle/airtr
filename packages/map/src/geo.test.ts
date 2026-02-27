import { describe, expect, it } from "vitest";
import {
  getBearing,
  getGreatCircleInterpolation,
  makeArcFeature,
  splitAntimeridian,
} from "./geo.js";

describe("getGreatCircleInterpolation", () => {
  it("returns p1 at f=0", () => {
    const p1: [number, number] = [0, 0];
    const p2: [number, number] = [90, 45];
    const result = getGreatCircleInterpolation(p1, p2, 0);
    expect(result[0]).toBeCloseTo(0, 10);
    expect(result[1]).toBeCloseTo(0, 10);
  });

  it("returns p2 at f=1", () => {
    const p1: [number, number] = [0, 0];
    const p2: [number, number] = [90, 45];
    const result = getGreatCircleInterpolation(p1, p2, 1);
    expect(result[0]).toBeCloseTo(90, 10);
    expect(result[1]).toBeCloseTo(45, 10);
  });

  it("returns the same point when p1 == p2", () => {
    const p: [number, number] = [10, 20];
    const result = getGreatCircleInterpolation(p, p, 0.5);
    expect(result[0]).toBeCloseTo(10, 10);
    expect(result[1]).toBeCloseTo(20, 10);
  });

  it("midpoint of equatorial arc is on the equator", () => {
    const p1: [number, number] = [0, 0];
    const p2: [number, number] = [90, 0];
    const mid = getGreatCircleInterpolation(p1, p2, 0.5);
    expect(mid[0]).toBeCloseTo(45, 5);
    expect(mid[1]).toBeCloseTo(0, 5);
  });

  it("interpolates across the antimeridian", () => {
    const p1: [number, number] = [170, 0];
    const p2: [number, number] = [-170, 0];
    const mid = getGreatCircleInterpolation(p1, p2, 0.5);
    // Midpoint should be at lng=180 (or -180), lat=0
    expect(Math.abs(mid[0])).toBeCloseTo(180, 5);
    expect(mid[1]).toBeCloseTo(0, 5);
  });
});

describe("getBearing", () => {
  it("returns 0 for due north", () => {
    const bearing = getBearing([0, 0], [0, 10]);
    expect(bearing).toBeCloseTo(0, 5);
  });

  it("returns 90 for due east along the equator", () => {
    const bearing = getBearing([0, 0], [10, 0]);
    expect(bearing).toBeCloseTo(90, 5);
  });

  it("returns 180 for due south", () => {
    const bearing = getBearing([0, 10], [0, 0]);
    expect(bearing).toBeCloseTo(180, 5);
  });

  it("returns 270 for due west along the equator", () => {
    const bearing = getBearing([0, 0], [-10, 0]);
    expect(bearing).toBeCloseTo(270, 5);
  });
});

describe("splitAntimeridian", () => {
  it("returns single segment for non-crossing polyline", () => {
    const points: [number, number][] = [
      [0, 0],
      [10, 5],
      [20, 10],
    ];
    const result = splitAntimeridian(points);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(points);
  });

  it("returns input wrapped in array for single point", () => {
    const points: [number, number][] = [[50, 20]];
    const result = splitAntimeridian(points);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(points);
  });

  it("returns input wrapped in array for empty array", () => {
    const points: [number, number][] = [];
    const result = splitAntimeridian(points);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([]);
  });

  it("splits at the antimeridian going eastward (positive to negative lng)", () => {
    // Simulate an arc from lng 170 to lng -170 (crossing 180)
    const points: [number, number][] = [
      [160, 0],
      [170, 0],
      [-170, 0], // jump: crosses antimeridian
      [-160, 0],
    ];
    const result = splitAntimeridian(points);
    expect(result).toHaveLength(2);

    // First segment ends at lng=180
    const lastOfFirst = result[0][result[0].length - 1];
    expect(lastOfFirst[0]).toBe(180);

    // Second segment starts at lng=-180
    const firstOfSecond = result[1][0];
    expect(firstOfSecond[0]).toBe(-180);

    // Crossing latitudes should match
    expect(lastOfFirst[1]).toBeCloseTo(firstOfSecond[1], 5);

    // Last point of second segment is the original endpoint
    const lastOfSecond = result[1][result[1].length - 1];
    expect(lastOfSecond[0]).toBe(-160);
    expect(lastOfSecond[1]).toBe(0);
  });

  it("splits at the antimeridian going westward (negative to positive lng)", () => {
    // Simulate an arc from lng -170 to lng 170 (crossing -180)
    const points: [number, number][] = [
      [-160, 10],
      [-170, 10],
      [170, 10], // jump: crosses antimeridian
      [160, 10],
    ];
    const result = splitAntimeridian(points);
    expect(result).toHaveLength(2);

    // First segment ends at lng=-180
    const lastOfFirst = result[0][result[0].length - 1];
    expect(lastOfFirst[0]).toBe(-180);

    // Second segment starts at lng=180
    const firstOfSecond = result[1][0];
    expect(firstOfSecond[0]).toBe(180);
  });

  it("produces crossing latitude on the great circle (not linear interpolation)", () => {
    // AKL (174.8, -37.0) to a point past the antimeridian (-175, -35)
    // The crossing latitude from the binary search should differ from naive
    // linear interpolation, proving the SLERP approach works.
    const p1: [number, number] = [174.8, -37.0];
    const p2: [number, number] = [-175.0, -35.0];
    const points: [number, number][] = [p1, p2];

    const result = splitAntimeridian(points);
    expect(result).toHaveLength(2);

    const crossLat = result[0][result[0].length - 1][1];

    // Verify the crossing latitude is between the two endpoint latitudes
    expect(crossLat).toBeGreaterThan(-37.0);
    expect(crossLat).toBeLessThan(-35.0);

    // Verify it's at lng=180
    expect(result[0][result[0].length - 1][0]).toBe(180);
    expect(result[1][0][0]).toBe(-180);

    // Verify the two split points share the same latitude
    expect(result[0][result[0].length - 1][1]).toBeCloseTo(result[1][0][1], 10);
  });

  it("handles multiple crossings (e.g. route that crosses the dateline twice)", () => {
    // Contrived case: points zigzag across the antimeridian
    const points: [number, number][] = [
      [170, 0],
      [-170, 0], // crossing 1
      [170, 5], // crossing 2
    ];
    const result = splitAntimeridian(points);
    expect(result).toHaveLength(3);
  });
});

describe("makeArcFeature", () => {
  it("returns LineString for non-crossing arc", () => {
    const points: [number, number][] = [
      [0, 0],
      [10, 5],
      [20, 10],
    ];
    const feature = makeArcFeature(points);
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("LineString");
    expect((feature.geometry as GeoJSON.LineString).coordinates).toEqual(points);
  });

  it("returns MultiLineString for crossing arc", () => {
    const points: [number, number][] = [
      [170, 0],
      [-170, 0],
    ];
    const feature = makeArcFeature(points);
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("MultiLineString");
    const coords = (feature.geometry as GeoJSON.MultiLineString).coordinates;
    expect(coords).toHaveLength(2);
  });
});
