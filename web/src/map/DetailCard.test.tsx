import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AreaProps, CragProps, RouteOut } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { DetailCard, DetailCardBody } from "@/map/DetailCard";
import type { Selection } from "@/map/selection";

vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => false }));
// vaul unmounts immediately in jsdom (no animations), so render the drawer content unconditionally to check what DetailCard passes to it.
vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DrawerDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

const region: AreaProps = {
  id: 1, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region", parent_id: 34,
  crag_count: 49, route_count: 645, center: [19.75, 50.15], bbox: [19.7, 50.1, 19.8, 50.2],
};
const crag: CragProps = {
  id: 7, name: "Żabi Koń", slug: "zabi-kon", area_id: 102, area_kind: "sektor", in_sector: true,
  route_count: 1, grade_bands: [1, 0, 0, 0], grade_min: "V", grade_min_sort: 80, grade_max: "VI.3", grade_max_sort: 160, needs_location: false,
};
const route = (id: number, number: number, name: string): RouteOut => ({
  id, number, name, grade: "VI.1", grade_fr: "6b", grade_sort: 120, length_m: null, protection: null,
  first_ascent: null, year: null, description: null, kind: "sport",
});

function stubCrag(routes: RouteOut[]) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ routes, walls: [] })))));
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const providers = (node: ReactNode) => (
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>
  );
  const view = render(providers(ui));
  return { rerender: (node: ReactNode) => view.rerender(providers(node)) };
}

const handlers = () => ({ onZoom: vi.fn(), onOpenCrag: vi.fn(), onSelectCrag: vi.fn() });

beforeEach(() => stubCrag([]));
afterEach(() => vi.unstubAllGlobals());

describe("DetailCardBody", () => {
  it("region: liczby po polsku i przybliżanie", async () => {
    const props = handlers();
    wrap(<DetailCardBody selection={{ type: "region", area: region, bands: [5, 4, 3, 1], range: null, crags: [] }} {...props} />);
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dolina Kobylańska" })).toBeInTheDocument();
    expect(screen.getByText("49 skał")).toBeInTheDocument();
    expect(screen.getByText("645 dróg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Przybliż" }));
    expect(props.onZoom).toHaveBeenCalledWith([19.7, 50.1, 19.8, 50.2]);
  });

  it("region: zakres wycen i lista skał", async () => {
    const props = handlers();
    const crags = Array.from({ length: 10 }, (_, i) => ({ ...crag, id: 100 + i, name: `Skała ${i}`, route_count: i }));
    const range = { min: "IV", minSort: 60, max: "VI.3", maxSort: 160 };
    wrap(<DetailCardBody selection={{ type: "region", area: region, bands: [1, 1, 1, 1], range, crags }} {...props} />);
    expect(screen.getByText("IV – VI.3")).toBeInTheDocument();
    const buttons = within(screen.getByRole("list", { name: "Skały" })).getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons[0]).toHaveTextContent("Skała 9");
    expect(screen.getByText("i jeszcze 2 skały")).toBeInTheDocument();
    await userEvent.click(buttons[0]);
    expect(props.onSelectCrag).toHaveBeenCalledWith(crags[9]);
  });

  it("skała: zakres wycen, pierwsze drogi i przejście do reszty", async () => {
    stubCrag(Array.from({ length: 10 }, (_, i) => route(i + 1, 10 - i, `Droga ${10 - i}`)));
    const props = handlers();
    wrap(<DetailCardBody selection={{ type: "crag", crag }} {...props} />);
    expect(screen.getByText("Skała")).toBeInTheDocument();
    expect(screen.getByText("1 droga")).toBeInTheDocument();
    expect(screen.getByText("V – VI.3")).toBeInTheDocument();
    const items = within(await screen.findByRole("list", { name: "Drogi" })).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent("Droga 1");
    await userEvent.click(screen.getByRole("button", { name: "i jeszcze 2 drogi →" }));
    expect(props.onOpenCrag).toHaveBeenCalledWith("zabi-kon");
    await userEvent.click(screen.getByRole("button", { name: "Otwórz skałę" }));
    expect(props.onOpenCrag).toHaveBeenCalledTimes(2);
  });
});

describe("DetailCardBody (edycja)", () => {
  const regionSelection: Selection = { type: "region", area: region, bands: [1, 1, 1, 1], range: null, crags: [] };
  const unplaced = { ...crag, id: 8, name: "Komin", needs_location: true };
  const sectorArea: AreaProps = { ...region, id: 102, name: "Pieninki", kind: "sektor", parent_id: 1 };
  const sectorSelection: Selection = { type: "sektor", area: sectorArea, bands: [1, 1, 1, 1], range: null, crags: [crag, unplaced] };

  it("zalogowany: region ma przycisk nowego sektora i edycji", async () => {
    const onNewSector = vi.fn();
    wrap(<DetailCardBody selection={regionSelection} {...handlers()} editable onNewSector={onNewSector} onMoveCrag={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Edytuj obszar" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Nowy sektor" }));
    expect(onNewSector).toHaveBeenCalledWith(region);
  });

  it("zalogowany: sektor pokazuje skały do rozstawienia", async () => {
    const onMoveCrag = vi.fn();
    wrap(<DetailCardBody selection={sectorSelection} {...handlers()} editable onNewSector={vi.fn()} onMoveCrag={onMoveCrag} />);
    expect(screen.getByText("Do rozstawienia: 1")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Do rozstawienia" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(within(list).getByRole("button", { name: "Ustaw na mapie" }));
    expect(onMoveCrag).toHaveBeenCalledWith(unplaced);
    expect(screen.queryByRole("button", { name: "+ Nowy sektor" })).not.toBeInTheDocument();
  });

  it("zalogowany: region też pokazuje skały do rozstawienia", () => {
    wrap(<DetailCardBody selection={{ ...regionSelection, crags: [crag, unplaced] }} {...handlers()} editable onMoveCrag={vi.fn()} />);
    expect(screen.getByText("Do rozstawienia: 1")).toBeInTheDocument();
  });

  it("zalogowany: skała ma przycisk przesuwania", async () => {
    const onMoveCrag = vi.fn();
    wrap(<DetailCardBody selection={{ type: "crag", crag }} {...handlers()} editable onMoveCrag={onMoveCrag} />);
    await userEvent.click(screen.getByRole("button", { name: "Przesuń na mapie" }));
    expect(onMoveCrag).toHaveBeenCalledWith(crag);
  });

  it("niezalogowany nie widzi przycisków edycji", () => {
    for (const selection of [regionSelection, sectorSelection, { type: "crag", crag: unplaced } satisfies Selection]) {
      const view = render(
        <ThemeProvider>
          <QueryClientProvider client={new QueryClient()}>
            <DetailCardBody selection={selection} {...handlers()} onNewSector={vi.fn()} onMoveCrag={vi.fn()} />
          </QueryClientProvider>
        </ThemeProvider>,
      );
      expect(screen.queryByRole("button", { name: "Edytuj obszar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ Nowy sektor" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Do rozstawienia/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Przesuń na mapie" })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("DetailCard (telefon)", () => {
  it("zachowuje treść karty podczas zamykania szuflady", () => {
    const props = { onClose: vi.fn(), ...handlers() };
    const view = wrap(<DetailCard selection={{ type: "crag", crag }} {...props} />);
    expect(screen.getByRole("heading", { name: "Żabi Koń" })).toBeInTheDocument();
    view.rerender(<DetailCard selection={null} {...props} />);
    expect(screen.getByRole("heading", { name: "Żabi Koń" })).toBeInTheDocument();
  });
});
