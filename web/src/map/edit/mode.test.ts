import { describe, expect, it } from "vitest";
import type { AreaProps } from "@/lib/api";
import { parseMoveParam, toggleCrag, type MapMode } from "./mode";

const region = { id: 1 } as AreaProps;

describe("toggleCrag", () => {
  it("dodaje i odejmuje skałę", () => {
    const start: MapMode = { kind: "sector", region, selected: [] };
    const added = toggleCrag(toggleCrag(start, 5), 6);
    expect(added).toMatchObject({ selected: [5, 6] });
    expect(toggleCrag(added, 5)).toMatchObject({ selected: [6] });
  });
  it("poza trybem sektora nic nie zmienia", () => {
    const browse: MapMode = { kind: "browse" };
    expect(toggleCrag(browse, 5)).toBe(browse);
  });
});

describe("parseMoveParam", () => {
  it("czyta identyfikator", () => {
    expect(parseMoveParam("?przesun=12")).toBe(12);
  });
  it("śmieci dają null", () => {
    expect(parseMoveParam("")).toBeNull();
    expect(parseMoveParam("?przesun=abc")).toBeNull();
    expect(parseMoveParam("?przesun=")).toBeNull();
    expect(parseMoveParam("?inne=3")).toBeNull();
  });
});
