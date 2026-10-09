import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftFromWall, saveLocal } from "@/editor/draft";
import EditorPage from "@/editor/EditorPage";
import { useEditor } from "@/editor/store";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { ln, makeCrag, makeRoute, makeWall, pt } from "@/test/fixtures";

vi.mock("@/lib/useHtmlImage", () => ({
  useHtmlImage: () => ({ image: null, status: "loading" }),
}));
vi.mock("@/lib/useMediaQuery", () => ({
  useIsDesktop: () => true,
  useMediaQuery: () => true,
}));

const wall = makeWall(
  5,
  [
    ln(1, 0, 1, [pt(10, 0.1, 0.9, "start"), pt(11, 0.2, 0.5), pt(12, 0.3, 0.1, "stanowisko")]),
    ln(2, 1, 2, [pt(20, 0.5, 0.9, "start"), pt(21, 0.3, 0.1, "stanowisko")]),
  ],
  { version: 3 },
);
const crag = makeCrag([wall], [makeRoute(1, "Rysa"), makeRoute(2, "Filar"), makeRoute(3, "Okap")]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubFetch(loggedIn: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/auth/me") return Promise.resolve(loggedIn ? json({ nick: "ania" }) : json({}, 401));
      return Promise.resolve(json(crag));
    }),
  );
}

function renderEditor(path = `/skaly/${crag.slug}/topo/5`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <SessionProvider>
            <Routes>
              <Route path="/skaly/:slug/topo/:wallId" element={<EditorPage />} />
              <Route path="/skaly/:slug" element={<p>Strona skały</p>} />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("EditorPage", () => {
  it("shows the tools and the photo's lines in topo order", async () => {
    stubFetch(true);
    renderEditor();
    expect(await screen.findByRole("toolbar", { name: "Narzędzia edytora" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /Brzuchata Turniczka · Zdjęcie 1 — edycja topo/,
      }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("1Rysa");
    expect(rows[1]).toHaveTextContent("2Filar");
  });

  it("invites a logged-out visitor to log in", async () => {
    stubFetch(false);
    renderEditor();
    expect(await screen.findByText("Edycja topo po zalogowaniu.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✎ Edytuj" })).toBeInTheDocument();
  });

  it("offers to restore a draft kept on this device", async () => {
    const draft = draftFromWall(wall);
    saveLocal({ ...draft, lines: draft.lines.slice(1) }, new Date(2026, 9, 9, 14, 2));
    stubFetch(true);
    renderEditor();
    expect(await screen.findByText("Masz niezapisany szkic z 14:02")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Przywróć" }));
    expect(useEditor.getState().draft.lines.map((line) => line.key)).toEqual(["l2"]);
  });

  it("warns when the draft predates someone else's save", async () => {
    const draft = draftFromWall(wall);
    saveLocal({ ...draft, baseVersion: 2, lines: draft.lines.slice(1) });
    stubFetch(true);
    renderEditor();
    expect(await screen.findByText("Ktoś zapisał zmiany po Twoim szkicu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Porzuć szkic" }));
    expect(localStorage.getItem("topo-draft-5")).toBeNull();
  });

  it("undoes a kind change with Ctrl+Z and asks before leaving with changes", async () => {
    stubFetch(true);
    renderEditor();
    await screen.findByRole("toolbar", { name: "Narzędzia edytora" });
    useEditor.getState().setKind("l1", "p11", "hak");
    expect(useEditor.getState().draft.lines[0].points[1].kind).toBe("hak");
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(useEditor.getState().draft.lines[0].points[1].kind).toBe("ring");
    useEditor.getState().setKind("l1", "p11", "hak");
    await userEvent.click(screen.getByRole("button", { name: "Wyjdź z edytora" }));
    expect(await screen.findByText("Porzucić zmiany?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wyjdź" }));
    expect(await screen.findByText("Strona skały")).toBeInTheDocument();
  });

  it("starts a new line from the route picker", async () => {
    stubFetch(true);
    renderEditor();
    await userEvent.click(await screen.findByRole("button", { name: "Nowa linia" }));
    expect(await screen.findByText("Bez linii na tym zdjęciu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Okap/ }));
    const lines = useEditor.getState().draft.lines;
    expect(lines).toHaveLength(3);
    expect(lines[2].route).toEqual({ routeId: 3 });
    expect(screen.getByRole("button", { name: "Nowa linia" })).toHaveAttribute("aria-pressed", "true");
  });
});
