import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AreaCrag, AreaDetail } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import AreaPage from "./AreaPage";

vi.mock("@/area/AreaMap", () => ({ default: () => <div data-testid="area-map" /> }));

const crag = (id: number, name: string, routes: number, gradeMax: number | null, sector: string | null = null): AreaCrag => ({
  id, name, slug: `skala-${id}`, route_count: routes, grade_bands: [routes, 0, 0, 0],
  grade_min: gradeMax ? "IV" : null, grade_min_sort: gradeMax ? 60 : null, grade_max: gradeMax ? "VI.2" : null, grade_max_sort: gradeMax,
  sector_name: sector, lng: 19.7, lat: 50.1,
});

const region: AreaDetail = {
  id: 2, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region", description: null,
  path: [{ id: 1, name: "Jura", slug: "jura", kind: "obszar" }],
  children: [{ id: 3, name: "Grupa Żabiego Konia", slug: "grupa-zabiego-konia", kind: "sektor", crag_count: 1, route_count: 34, grade_bands: [4, 10, 15, 5] }],
  crags: [crag(10, "Żabi Koń", 34, 180, "Grupa Żabiego Konia"), crag(11, "Babia Turnia", 18, 150), crag(12, "Ambona", 2, null)],
  center: [19.7, 50.1], bbox: [19.6, 50.0, 19.8, 50.2],
};
const top: AreaDetail = {
  ...region, id: 1, name: "Jura", slug: "jura", kind: "obszar", path: [], crags: [], center: null, bbox: null,
  children: [{ id: 2, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region", crag_count: 3, route_count: 54, grade_bands: [1, 1, 1, 1] }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function renderPage(area: AreaDetail) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => (url === "/api/auth/me" ? Promise.resolve(json({ nick: null })) : Promise.resolve(json(area)))),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/obszary/${area.slug}`]}>
          <SessionProvider>
            <Routes>
              <Route path="/obszary/:slug" element={<AreaPage />} />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const cragNames = () => within(screen.getByRole("heading", { name: "Skały" }).closest("section")!).getAllByRole("link").map((link) => link.querySelector("span span")?.textContent);

afterEach(() => vi.unstubAllGlobals());

describe("AreaPage", () => {
  it("shows a region: path, counts, map, sectors and all its crags (also from sectors)", async () => {
    renderPage(region);
    expect(await screen.findByRole("heading", { name: "Dolina Kobylańska" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jura" })).toHaveAttribute("href", "/obszary/jura");
    expect(screen.getByText("1 sektor")).toBeInTheDocument();
    expect(screen.getByText("3 skały")).toBeInTheDocument();
    expect(screen.getByText("54 drogi")).toBeInTheDocument();
    expect(await screen.findByTestId("area-map")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Grupa Żabiego Konia/ })).toHaveAttribute("href", "/obszary/grupa-zabiego-konia");
    expect(cragNames()).toEqual(["Ambona", "Babia Turnia", "Żabi Koń"]);
    expect(screen.getByRole("link", { name: /Żabi Koń/ })).toHaveAttribute("href", "/skaly/skala-10");
    expect(screen.getByText("Grupa Żabiego Konia · IV – VI.2")).toBeInTheDocument();
  });

  it("sorts crags by route count and by difficulty", async () => {
    renderPage(region);
    await userEvent.click(await screen.findByRole("radio", { name: "liczba dróg" }));
    expect(cragNames()).toEqual(["Żabi Koń", "Babia Turnia", "Ambona"]);
    await userEvent.click(screen.getByRole("radio", { name: "trudność" }));
    expect(cragNames()).toEqual(["Żabi Koń", "Babia Turnia", "Ambona"]);
  });

  it("the top level lists regions only", async () => {
    renderPage(top);
    expect(await screen.findByRole("heading", { name: "Regiony" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Skały" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("area-map")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dolina Kobylańska/ })).toHaveAttribute("href", "/obszary/dolina-kobylanska");
  });
});
