import { describe, expect, it } from "vitest";
import { draggedAfterStart, isDrag } from "@/crag/gesture";

describe("reguła gestu", () => {
  it("świeży gest jednym palcem zaczyna się bez przeciągnięcia", () => {
    expect(draggedAfterStart(true, false, 1)).toBe(false);
  });

  it("dwa palce to nigdy tap", () => {
    expect(draggedAfterStart(false, false, 2)).toBe(true);
    expect(draggedAfterStart(false, true, 2)).toBe(true);
  });

  it("po uniesieniu jednego palca gest trwa dalej i zachowuje przeciągnięcie (tap po pinchu nie zaznacza)", () => {
    expect(draggedAfterStart(true, true, 1)).toBe(true);
    expect(draggedAfterStart(false, true, 1)).toBe(false);
  });

  it("przeciągnięcie dopiero po przekroczeniu progu", () => {
    expect(isDrag(4)).toBe(false);
    expect(isDrag(4.1)).toBe(true);
  });
});
