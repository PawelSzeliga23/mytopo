import { describe, expect, it } from "vitest";
import { clampView, fitImage, IDENTITY, panBy, toScreen, zoomAt, type View } from "@/crag/view";

const box = { width: 800, height: 400 };

function near(view: View, zoom: number, x: number, y: number) {
  expect(view.zoom).toBeCloseTo(zoom);
  expect(view.x).toBeCloseTo(x);
  expect(view.y).toBeCloseTo(y);
}

describe("dopasowanie zdjęcia", () => {
  it("pionowe zdjęcie w poziomym kontenerze: całe widoczne, wyśrodkowane", () => {
    expect(fitImage(box, { width: 1000, height: 2000 })).toEqual({ scale: 0.2, x: 300, y: 0 });
  });

  it("punkt 0–1 na ekranie", () => {
    expect(toScreen({ x: 0.5, y: 1 }, { width: 1000, height: 2000 }, box, IDENTITY)).toEqual({ x: 400, y: 400 });
  });
});

describe("przybliżanie i przesuwanie", () => {
  it("punkt pod kursorem zostaje na miejscu", () => {
    near(zoomAt(IDENTITY, { x: 200, y: 100 }, 2, box), 2, -200, -100);
  });

  it("zakres przybliżenia 1–5", () => {
    near(zoomAt(IDENTITY, { x: 400, y: 200 }, 0.5, box), 1, 0, 0);
    near(zoomAt({ zoom: 4, x: -1000, y: -500 }, { x: 0, y: 0 }, 4, box), 5, -1250, -625);
  });

  it("nie da się wyjechać poza zdjęcie ani przesunąć przy przybliżeniu 1", () => {
    near(clampView({ zoom: 2, x: 100, y: -9999 }, box), 2, 0, -400);
    near(panBy(IDENTITY, 50, 50, box), 1, 0, 0);
    near(panBy({ zoom: 2, x: -100, y: -100 }, -50, 20, box), 2, -150, -80);
  });
});
