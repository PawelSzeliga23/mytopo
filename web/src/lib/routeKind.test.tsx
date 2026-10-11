import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RouteKindToggle } from "@/components/RouteKindToggle";
import { applyKind, collectionOfKind, itemsOfKind, KIND_KEY, matchesKind, RouteKindProvider, useRouteKind } from "@/lib/routeKind";

const stats = (route_count: number, grade_bands = [route_count, 0, 0, 0]) => ({ route_count, grade_bands });
const crag = (id: number, sport: number, trad: number) => ({
  id, ...stats(sport + trad), by_kind: { sport: stats(sport), trad: stats(trad) },
});  // prettier-ignore

describe("statystyki dla rodzaju dróg", () => {
  it("podmienia liczby na wybrany rodzaj, bez filtra zostawia wszystkie", () => {
    expect(applyKind(crag(1, 2, 1), "trad")).toMatchObject({ id: 1, route_count: 1, grade_bands: [1, 0, 0, 0] });
    expect(applyKind(crag(1, 2, 1), "all").route_count).toBe(3);
    expect(applyKind({ id: 1, route_count: 4 }, "sport").route_count).toBe(0);
  });

  it("usuwa elementy bez dróg danego rodzaju", () => {
    expect(itemsOfKind([crag(1, 2, 0), crag(2, 0, 3)], "sport").map((item) => item.id)).toEqual([1]);
    const collection = { type: "FeatureCollection", features: [crag(1, 2, 0), crag(2, 0, 3)].map((properties) => ({ properties })) };
    expect(collectionOfKind(collection, "trad")!.features.map((feature) => feature.properties)).toEqual([{ ...crag(2, 0, 3), route_count: 3, grade_bands: [3, 0, 0, 0] }]);
    expect(collectionOfKind(collection, "all")).toBe(collection);
  });

  it("droga pasuje do filtra", () => {
    expect(matchesKind({ kind: "trad" }, "sport")).toBe(false);
    expect(matchesKind({ kind: "trad" }, "trad")).toBe(true);
    expect(matchesKind({ kind: "trad" }, "all")).toBe(true);
  });
});

function Shown() {
  return <output>{useRouteKind().kind}</output>;
}

describe("przełącznik rodzaju dróg", () => {
  afterEach(() => localStorage.clear());

  it("zmienia filtr i zapamiętuje go w przeglądarce", async () => {
    const view = render(<RouteKindProvider><RouteKindToggle /><Shown /></RouteKindProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("all");
    await userEvent.click(screen.getByRole("radio", { name: "Trad" }));
    expect(screen.getByRole("status")).toHaveTextContent("trad");
    expect(localStorage.getItem(KIND_KEY)).toBe("trad");
    view.unmount();

    render(<RouteKindProvider><Shown /></RouteKindProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("trad");
  });

  it("na telefonie jedna pigułka przechodzi do kolejnego stanu", async () => {
    render(<RouteKindProvider><RouteKindToggle /><Shown /></RouteKindProvider>);
    await userEvent.click(screen.getByRole("button", { name: /Rodzaj dróg: Wszystkie/ }));
    expect(screen.getByRole("status")).toHaveTextContent("sport");
  });
});
