import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftKey } from "@/editor/draft";
import EditorPage from "@/editor/EditorPage";
import { useEditor } from "@/editor/store";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { ln, makeCrag, makeRoute, makeWall, pt } from "@/test/fixtures";

vi.mock("@/lib/useHtmlImage", () => ({ useHtmlImage: () => ({ image: null, status: "loading" }) }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => true, useMediaQuery: () => true }));

const wall = makeWall(5, [ln(1, 0, 1, [pt(10, 0.1, 0.9, "start"), pt(11, 0.2, 0.5), pt(12, 0.3, 0.1, "stanowisko")])], { version: 3 });
const crag = makeCrag([wall], [makeRoute(1, "Rysa")]);
// What GET /api/crags returns; a test can swap it to simulate someone else's save.
let served = crag;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Reply = (body: Record<string, unknown>) => Response;

function stubFetch(replies: Reply[], loggedIn = true) {
  const puts: Record<string, unknown>[] = [];
  let me = loggedIn;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return Promise.resolve(me ? json({ nick: "ania" }) : json({}, 401));
      if (url === "/api/auth/login") {
        me = true;
        return Promise.resolve(json({ nick: "ania" }));
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return Promise.resolve(replies[puts.length - 1](body));
      }
      return Promise.resolve(json(served));
    }),
  );
  return puts;
}

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/skaly/${crag.slug}/topo/5`]}>
          <SessionProvider>
            <Routes>
              <Route path="/skaly/:slug/topo/:wallId" element={<EditorPage />} />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function editAndSave(comment = "") {
  await screen.findByRole("toolbar", { name: "Narzędzia edytora" });
  const key = useEditor.getState().newLine({ routeId: 1 });
  useEditor.getState().appendPoint(key, { x: 0.7, y: 0.9 });
  useEditor.getState().appendPoint(key, { x: 0.7, y: 0.2 });
  await userEvent.click(await screen.findByRole("button", { name: /^Zapisz \(1 zmiana\)/ }));
  if (comment) await userEvent.type(screen.getByRole("textbox", { name: "Komentarz" }), comment);
  await userEvent.click(screen.getByRole("button", { name: "Zapisz" }));
  return key;
}

beforeEach(() => {
  localStorage.clear();
  served = crag;
});
afterEach(() => vi.unstubAllGlobals());

describe("saving the topo", () => {
  it("sends the whole draft with the comment and rebases on the answer", async () => {
    const puts = stubFetch([() => json({ version: 4, ids: { n1: 50, n2: 500, n3: 501 } })]);
    renderEditor();
    const key = await editAndSave("nowa linia");
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ version: 3, comment: "nowa linia" });
    expect((puts[0].lines as unknown[]).length).toBe(2);
    await waitFor(() => expect(useEditor.getState().draft.baseVersion).toBe(4));
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(localStorage.getItem(draftKey(5))).toBeNull();
    // Undo after the save steps back through states that already carry the real ids.
    useEditor.temporal.getState().undo();
    expect(useEditor.getState().draft.lines.find((line) => line.key === key)?.id).toBe(50);
  });

  it("blocks saving while a line has fewer than two points", async () => {
    stubFetch([]);
    renderEditor();
    await screen.findByRole("toolbar", { name: "Narzędzia edytora" });
    const key = useEditor.getState().newLine({ routeId: 1 });
    useEditor.getState().appendPoint(key, { x: 0.7, y: 0.9 });
    const button = await screen.findByRole("button", { name: /^Zapisz \(1 zmiana\)/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Linia 2 ma za mało punktów");
  });

  it("offers to overwrite after a version conflict, then saves with the current version", async () => {
    const puts = stubFetch([
      () => {
        served = makeCrag([{ ...wall, version: 7 }], crag.routes);
        return json({ code: "version_conflict", message: "Ktoś zapisał topo w międzyczasie", current_version: 7 }, 409);
      },
      () => json({ version: 8, ids: {} }),
    ]);
    renderEditor();
    await editAndSave();
    expect(await screen.findByText("Ktoś zapisał topo w międzyczasie")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nadpisz moją" }));
    await userEvent.click(screen.getByRole("button", { name: "Nadpisz" }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].version).toBe(7);
    expect(puts[1].lines).toEqual(puts[0].lines);
  });

  it("asks to log in on 401 and repeats the same save", async () => {
    const puts = stubFetch([
      () => json({ code: "unauthorized", message: "Zaloguj się, aby edytować" }, 401),
      () => json({ version: 4, ids: {} }),
    ]);
    renderEditor();
    await editAndSave();
    await userEvent.type(await screen.findByLabelText("Hasło"), "tajne");
    await userEvent.type(screen.getByLabelText(/Twój nick/), "ania");
    await userEvent.click(screen.getByRole("button", { name: "Wejdź" }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual(puts[0]);
  });
});
