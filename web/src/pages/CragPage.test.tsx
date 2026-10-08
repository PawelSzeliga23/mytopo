import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallViewerProps } from "@/crag/WallViewer";
import type { CragDetail } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import CragPage from "@/pages/CragPage";
import { ln, makeCrag, makeRoute, makeWall, pt } from "@/test/fixtures";

// Konva needs a real canvas; the page is tested against a stand-in that exposes the viewer's props.
vi.mock("@/crag/WallViewer", () => ({
  WallViewer: ({ wall, selectedRouteId, onSelectRoute, onHoverRoute }: WallViewerProps) => (
    <div data-testid="viewer" data-wall={wall.id} data-selected={selectedRouteId ?? ""}>
      {wall.lines.map((line) => (
        <button key={line.id} type="button" onClick={() => onSelectRoute(line.route_id)} onMouseEnter={() => onHoverRoute(line.route_id)}>
          {`linia ${line.route_id}`}
        </button>
      ))}
    </div>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

const left = makeWall(20, [
  ln(1, 10, 1, [pt(1, 0.1, 0.9, "start"), pt(2, 0.1, 0.5)]),
  ln(2, 20, 2, [pt(10, 0.4, 0.9, "start"), pt(11, 0.4, 0.6)]),
  ln(3, 21, 3, [pt(20, 0.4, 0.6), pt(21, 0.6, 0.3)], [2, 11]),
], { name: "Lewa ściana" });
const right = makeWall(21, [ln(4, 10, 4, [pt(30, 0.5, 0.9, "start"), pt(31, 0.5, 0.5)])], { name: "Prawa ściana" });
const routes = [
  makeRoute(1, "Kobylański pikuś", { grade: "VI.2+", grade_fr: "6c+", grade_sort: 146, length_m: 9, protection: "2r + DRZ", first_ascent: "P. Rostek", year: 1997, description: "Rysa" }),
  makeRoute(2, "Żelazny karzeł"),
  makeRoute(3, "Wariant karła"),
  makeRoute(4, "Prawa droga"),
  makeRoute(5, "Projekt", { grade: null, grade_fr: null, grade_sort: null }),
];
const crag = makeCrag([left, right], routes);

function renderAt(data: CragDetail | Response, entries = ["/skaly/brzuchata-turniczka"]) {
  const response = data instanceof Response ? data : new Response(JSON.stringify(data));
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>Mapa</p> },
      { path: "/skaly/:slug", element: <CragPage /> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

const rowsOf = (name: string) => within(screen.getByRole("list", { name })).getAllByRole("button");
const row = (name: RegExp) => screen.getByRole("button", { name });

describe("CragPage", () => {
  it("nagłówek, ścieżka i chipy", async () => {
    renderAt(crag);
    expect(await screen.findByRole("heading", { name: "Brzuchata Turniczka" })).toBeInTheDocument();
    expect(screen.getByText("Dolina Kobylańska")).toBeInTheDocument();
    expect(screen.getByText("wapień")).toBeInTheDocument();
    expect(screen.getByText("10 m")).toBeInTheDocument();
    expect(screen.getByText("wystawa N")).toBeInTheDocument();
    expect(screen.getByText("dojście 5 min")).toBeInTheDocument();
  });

  it("drogi z numerami jak na zdjęciu, pozostałe z podpowiedzią", async () => {
    renderAt(crag);
    await screen.findByRole("heading", { name: "Brzuchata Turniczka" });
    const onWall = rowsOf("Na tym zdjęciu");
    expect(onWall.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Kobylański pikuś"), expect.stringContaining("Żelazny karzeł"), expect.stringContaining("Wariant karła"),
    ]);
    expect(within(onWall[2]).getByText("2a")).toBeInTheDocument();
    expect(within(onWall[0]).getByText("2r + DRZ · 9 m · P. Rostek, 1997")).toBeInTheDocument();
    const other = rowsOf("Pozostałe drogi");
    expect(within(other[0]).getByText("na zdjęciu „Prawa ściana”")).toBeInTheDocument();
    expect(within(other[1]).getByText("bez topo")).toBeInTheDocument();
    expect(within(other[1]).getByTitle("bez wyceny")).toBeInTheDocument();
  });

  it("kliknięcie drogi na liście zaznacza linię i pokazuje opis; drugie odznacza", async () => {
    renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: /Kobylański pikuś/ }));
    expect(row(/Kobylański pikuś/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-selected", "1");
    expect(screen.getByText("Rysa")).toBeInTheDocument();
    await userEvent.click(row(/Kobylański pikuś/));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-selected", "");
  });

  it("kliknięcie i najechanie linii na zdjęciu zaznacza drogę na liście", async () => {
    renderAt(crag);
    await userEvent.hover(await screen.findByRole("button", { name: "linia 3" }));
    expect(row(/Wariant karła/)).toHaveAttribute("data-hovered", "true");
    await userEvent.click(screen.getByRole("button", { name: "linia 2" }));
    expect(row(/Żelazny karzeł/)).toHaveAttribute("aria-pressed", "true");
  });

  it("droga z innego zdjęcia przełącza zdjęcie i numerację", async () => {
    renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: /Prawa droga/ }));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-wall", "21");
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-selected", "4");
    expect(within(rowsOf("Na tym zdjęciu")[0]).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prawa ściana" })).toHaveAttribute("aria-pressed", "true");
  });

  it("miniatury przełączają zdjęcie", async () => {
    renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: "Prawa ściana" }));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-wall", "21");
    expect(rowsOf("Na tym zdjęciu")).toHaveLength(1);
  });

  it("skała bez zdjęć: komunikat i lista dróg", async () => {
    renderAt(makeCrag([], routes));
    expect(await screen.findByText("Ta skała nie ma jeszcze zdjęć z topo.")).toBeInTheDocument();
    expect(rowsOf("Drogi")).toHaveLength(5);
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
  });

  it("← Mapa wraca do mapy, z której przyszliśmy", async () => {
    const router = renderAt(crag, ["/#12.00/50.10000/19.70000", "/skaly/brzuchata-turniczka"]);
    await userEvent.click(await screen.findByRole("button", { name: "← Mapa" }));
    expect(await screen.findByText("Mapa")).toBeInTheDocument();
    expect(router.state.location.hash).toBe("#12.00/50.10000/19.70000");
  });

  it("← Mapa po wejściu z linku: mapa przy skale", async () => {
    const router = renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: "← Mapa" }));
    expect(await screen.findByText("Mapa")).toBeInTheDocument();
    expect(router.state.location.hash).toBe("#15.00/50.16614/19.76472");
  });

  it("404 → nie znaleziono", async () => {
    renderAt(new Response(JSON.stringify({ code: "not_found", message: "Nie znaleziono: skała" }), { status: 404 }));
    expect(await screen.findByText("Nie znaleziono skały")).toBeInTheDocument();
  });
});
