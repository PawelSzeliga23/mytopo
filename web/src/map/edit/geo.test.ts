import { describe, expect, it } from "vitest";
import type { AreaProps } from "@/lib/api";
import { convexHull, distanceMeters, formatDistance, nearestSector } from "./geo";

const sector = (id: number, center: [number, number]): AreaProps => ({
  id, name: `S${id}`, slug: `s${id}`, kind: "sektor", parent_id: 1, crag_count: 1, route_count: 1, center, bbox: [0, 0, 0, 0],
});

describe("distanceMeters", () => {
  it("Kraków–Warszawa to około 252 km", () => {
    const km = distanceMeters([19.945, 50.0647], [21.0122, 52.2297]) / 1000;
    expect(km).toBeGreaterThan(250);
    expect(km).toBeLessThan(254);
  });
  it("ten sam punkt to 0", () => {
    expect(distanceMeters([19.9, 50.1], [19.9, 50.1])).toBe(0);
  });
});

describe("convexHull", () => {
  it("kwadrat z punktem w środku ma 4 wierzchołki", () => {
    const hull = convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([1, 1]);
  });
  it("mniej niż 3 punkty zwraca bez zmian", () => {
    expect(convexHull([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });
});

describe("nearestSector", () => {
  const sectors = [sector(1, [19.9, 50.1]), sector(2, [19.905, 50.1])];
  it("wybiera najbliższy w promieniu 3 km", () => {
    expect(nearestSector([19.904, 50.1], sectors)?.id).toBe(2);
  });
  it("dalej niż 3 km zwraca null", () => {
    expect(nearestSector([20.2, 50.1], sectors)).toBeNull();
  });
  it("bez limitu zwraca najbliższy mimo odległości", () => {
    expect(nearestSector([20.2, 50.1], sectors, Infinity)?.id).toBe(2);
  });
});

describe("formatDistance", () => {
  it("metry i kilometry po polsku", () => {
    expect(formatDistance(140.4)).toBe("140 m");
    expect(formatDistance(1234)).toBe("1,2 km");
  });
});
