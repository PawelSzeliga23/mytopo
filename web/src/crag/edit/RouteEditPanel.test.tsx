import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteList } from "@/crag/RouteList";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import CragPage from "@/pages/CragPage";
import { makeCrag, makeRoute } from "@/test/fixtures";
import { RouteEditPanel } from "./RouteEditPanel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const route = makeRoute(7, "Filar", { grade: "VI.1", length_m: 25 });
const crag = makeCrag([], [route]);

let desktop = true;
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  desktop = true;
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: desktop })) as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.unstubAllGlobals();
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** `reply` answers writes; everything else (session, crag) succeeds. */
function stubFetch(reply: (call: Call) => Response = () => json({ id: route.id, changed: [] })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return Promise.resolve(json({ nick: "ania" }));
      if (init?.method && init.method !== "GET") {
        const call = { method: init.method, url, body: init.body ? JSON.parse(String(init.body)) : null };
        calls.push(call);
        return Promise.resolve(reply(call));
      }
      return Promise.resolve(json(crag));
    }),
  );
  return calls;
}

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionProvider>{ui}</SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("RouteEditPanel", () => {
  it("zapis zmienionej wyceny wysyła PATCH tylko z wyceną", async () => {
    const calls = stubFetch();
    const onClose = vi.fn();
    renderWith(<RouteEditPanel cragId={crag.id} slug={crag.slug} route={route} onClose={onClose} />);
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    const grade = await screen.findByLabelText("Wycena");
    await userEvent.clear(grade);
    await userEvent.type(grade, "VI.1+");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual([{ method: "PATCH", url: `/api/routes/${route.id}`, body: { grade: "VI.1+", comment: null } }]);
  });

  it("422 invalid_grade pokazuje błąd przy wycenie i nie zamyka panelu", async () => {
    stubFetch(() => json({ code: "invalid_grade", message: "Nieznana wycena „VI.x”" }, 422));
    const onClose = vi.fn();
    renderWith(<RouteEditPanel cragId={crag.id} slug={crag.slug} route={route} onClose={onClose} />);
    const grade = await screen.findByLabelText("Wycena");
    await userEvent.clear(grade);
    await userEvent.type(grade, "VI.x");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(await screen.findByText("Nieznana wycena „VI.x”")).toBeInTheDocument();
    expect(grade).toHaveAttribute("aria-invalid", "true");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Wycena")).toHaveValue("VI.x");
  });

  it("nowa droga wysyła POST z wypełnionymi polami", async () => {
    const calls = stubFetch(() => json({ id: 99 }, 201));
    const onClose = vi.fn();
    renderWith(<RouteEditPanel cragId={crag.id} slug={crag.slug} route={null} onClose={onClose} />);
    expect(screen.queryByLabelText("Numer")).not.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("Nazwa"), "Nowa");
    await userEvent.type(screen.getByLabelText("Długość (m)"), "12.5");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual([{ method: "POST", url: `/api/crags/${crag.id}/routes`, body: { name: "Nowa", length_m: 12.5, comment: null } }]);
    expect(screen.queryByRole("button", { name: "Usuń" })).not.toBeInTheDocument();
  });

  it("Usuń pyta o potwierdzenie i wysyła DELETE", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const onClose = vi.fn();
    renderWith(<RouteEditPanel cragId={crag.id} slug={crag.slug} route={route} onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Usuń" }));
    expect(calls).toEqual([]);
    expect(await screen.findByText("Usunąć drogę „Filar”?")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Usuń" }).at(-1)!);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual([{ method: "DELETE", url: `/api/routes/${route.id}`, body: null }]);
  });

  it("na telefonie panel to szuflada z tym samym formularzem", async () => {
    desktop = false;
    stubFetch();
    renderWith(<RouteEditPanel cragId={crag.id} slug={crag.slug} route={route} onClose={vi.fn()} />);
    expect(await screen.findByLabelText("Wycena")).toHaveValue("VI.1");
  });
});

describe("RouteList — edycja", () => {
  const rows = { onWall: [{ route, wallId: null, lineId: null, label: "1" }], other: [] };
  const props = { rows, wallNames: new Map<number, string>(), selectedRouteId: null, hoveredRouteId: null, onChoose: vi.fn(), onHover: vi.fn() };

  it("✎ i „+ Dodaj drogę” tylko przy editable", async () => {
    const onEdit = vi.fn();
    const onChoose = vi.fn();
    const { rerender } = renderWith(<RouteList {...props} />);
    expect(screen.queryByRole("button", { name: "Edytuj drogę Filar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Dodaj drogę" })).not.toBeInTheDocument();
    rerender(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <SessionProvider>
              <RouteList {...props} onChoose={onChoose} editable onEdit={onEdit} onAdd={vi.fn()} />
            </SessionProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edytuj drogę Filar" }));
    expect(onEdit).toHaveBeenCalledWith(route);
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "+ Dodaj drogę" })).toBeInTheDocument();
    expect(screen.getByTestId("grade")).toHaveTextContent("VI.1");
  });
});

describe("CragPage — panel drogi", () => {
  it("✎ otwiera panel z drogą, a „+ Dodaj drogę” pusty", async () => {
    stubFetch();
    renderWith(<CragPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edytuj drogę Filar" }));
    expect(await screen.findByLabelText("Wycena")).toHaveValue("VI.1");
    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByLabelText("Wycena")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Dodaj drogę" }));
    expect(await screen.findByLabelText("Nazwa")).toHaveValue("");
  });
});
