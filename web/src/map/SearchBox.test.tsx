import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AreaProps, SearchResult } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { SearchBox } from "./SearchBox";

const json = (body: unknown) => new Response(JSON.stringify(body));
const empty: SearchResult = { areas: [], crags: [], walls: [], routes: [], totals: { areas: 0, crags: 0, walls: 0, routes: 0 } };
const route = (id: number, name: string) => ({ id, name, grade: "VI.1", grade_sort: 120, length_m: 20, crag_name: "Żabi Koń", crag_slug: "zabi-kon" });
const result: SearchResult = {
  areas: [{ id: 3, name: "Grupa Żabiego Konia", slug: "grupa-zabiego-konia", kind: "sektor", parent_name: "Dolina Kobylańska" }],
  crags: [{ id: 10, name: "Żabi Koń", slug: "zabi-kon", area_name: "Grupa Żabiego Konia", route_count: 34 }],
  walls: [{ id: 7, name: "Żabia Ściana", crag_name: "Żabi Koń", crag_slug: "zabi-kon" }],
  routes: [route(5, "Rysa Żabia")],
  totals: { areas: 1, crags: 1, walls: 1, routes: 21 },
};
const areas = [
  { id: 2, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region", parent_id: 1 },
  { id: 3, name: "Grupa Żabiego Konia", slug: "grupa-zabiego-konia", kind: "sektor", parent_id: 2 },
] as AreaProps[];

function stubSearch(reply: (params: URLSearchParams) => SearchResult = () => result) {
  const calls: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const params = new URL(url, "http://x").searchParams;
      calls.push(params);
      return Promise.resolve(json(reply(params)));
    }),
  );
  return calls;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderBox() {
  const onPickArea = vi.fn();
  const onPickCrag = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Routes>
            <Route path="*" element={<><SearchBox areas={areas} onPickArea={onPickArea} onPickCrag={onPickCrag} /><Where /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { onPickArea, onPickCrag, input: screen.getByRole("combobox") };
}

afterEach(() => vi.unstubAllGlobals());

describe("SearchBox", () => {
  it("asks once typing stops and groups the suggestions", async () => {
    const calls = stubSearch();
    const { input } = renderBox();
    await userEvent.type(input, "zabi");
    expect(await screen.findByText("Rysa Żabia")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0].get("q")).toBe("zabi");
    expect(calls[0].get("type")).toBe("all");
    for (const title of ["Obszary", "Skały", "Ściany", "Drogi · 21"]) expect(screen.getByText(title)).toBeInTheDocument();
  });

  it("Enter opens the first suggestion: an area is framed on the map", async () => {
    stubSearch();
    const { input, onPickArea } = renderBox();
    await userEvent.type(input, "zabi");
    await screen.findByText("Rysa Żabia");
    await userEvent.keyboard("{Enter}");
    expect(onPickArea).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("arrows move the highlight: a crag flies the map, a route and a wall open the crag page", async () => {
    stubSearch();
    const { input, onPickCrag } = renderBox();
    await userEvent.type(input, "zabi");
    await screen.findByText("Rysa Żabia");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onPickCrag).toHaveBeenCalledWith(10);

    await userEvent.click(input);
    await userEvent.click(screen.getByRole("button", { name: /Żabia Ściana/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/skaly/zabi-kon?sciana=7");

    await userEvent.click(input);
    await userEvent.click(screen.getByRole("button", { name: /Rysa Żabia/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/skaly/zabi-kon?droga=5");
  });

  it("filters go to the API; filters alone list routes; 'jeszcze' loads the next page", async () => {
    const calls = stubSearch((params) =>
      params.get("offset") === "20"
        ? { ...empty, routes: [route(99, "Ostatnia")], totals: { ...empty.totals, routes: 21 } }
        : { ...empty, routes: Array.from({ length: 20 }, (_, n) => route(n + 1, `Droga ${n + 1}`)), totals: { ...empty.totals, routes: 21 } },
    );
    const { input } = renderBox();
    await userEvent.click(input);
    expect(screen.getByText(/co najmniej 2 litery/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "drogi" }));
    await userEvent.selectOptions(screen.getByLabelText("Wycena od"), "VI");
    await userEvent.selectOptions(screen.getByLabelText("Wycena do"), "VI.2");
    await userEvent.selectOptions(screen.getByLabelText("Obszar"), "dolina-kobylanska");
    expect(await screen.findByText("Droga 20")).toBeInTheDocument();
    const last = calls.at(-1)!;
    expect([last.get("q"), last.get("type"), last.get("grade_min"), last.get("grade_max"), last.get("area")]).toEqual(["", "routes", "VI", "VI.2", "dolina-kobylanska"]);
    await userEvent.click(screen.getByRole("button", { name: "jeszcze 1 droga ▾" }));
    expect(await screen.findByText("Ostatnia")).toBeInTheDocument();
    expect(calls.at(-1)!.get("offset")).toBe("20");
  });

  it("Escape closes the list", async () => {
    stubSearch();
    const { input } = renderBox();
    await userEvent.type(input, "zabi");
    await screen.findByText("Rysa Żabia");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
