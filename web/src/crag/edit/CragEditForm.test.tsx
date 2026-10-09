import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import CragPage from "@/pages/CragPage";
import { makeCrag } from "@/test/fixtures";
import { CragEditForm } from "./CragEditForm";
import { draftToPatch, toDraft } from "./fields";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const crag = makeCrag([],[], { formations: ["Baszta"], description: "Stary opis" });

function stubFetch(loggedIn: boolean) {
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return Promise.resolve(loggedIn ? json({ nick: "ania" }) : json({}, 401));
      if (init?.method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(json({ id: crag.id, changed: [] }));
      }
      return Promise.resolve(json(crag));
    }),
  );
  return patches;
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

describe("draftToPatch", () => {
  const original = toDraft(crag);

  it("bez zmian — pusty patch", () => {
    expect(draftToPatch(original, { ...original })).toEqual({});
  });

  it("liczby, wystawa i formacje", () => {
    const patch = draftToPatch(original, { ...original, height_max: "35,5", approach_minutes: "12", aspects: ["S", "N"], formations: "Baszta, Iglica ," });
    expect(patch).toEqual({ height_max: 35.5, approach_minutes: 12, aspects: ["N", "S"], formations: ["Baszta", "Iglica"] });
  });

  it("puste pola to null, dla dzieci: tak/nie/brak", () => {
    expect(draftToPatch(original, { ...original, description: "", height_min: "", rock_type: " ", child_friendly: "" })).toEqual({
      description: null,
      height_min: null,
      rock_type: null,
      child_friendly: null,
    });
    expect(draftToPatch(original, { ...original, child_friendly: "nie" })).toEqual({ child_friendly: false });
  });
});

describe("CragEditForm", () => {
  it("licznik zmian i zapis tylko zmienionych pól z komentarzem", async () => {
    const patches = stubFetch(true);
    const onDone = vi.fn();
    renderWith(<CragEditForm crag={crag} onDone={onDone} />);
    const save = await screen.findByRole("button", { name: "Zapisz zmiany (0)" });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Czas dojścia (min)"), "0");
    await userEvent.type(screen.getByLabelText("Opis"), " rozszerzony");
    expect(screen.getByRole("button", { name: "Zapisz zmiany (2)" })).toBeEnabled();

    await userEvent.type(screen.getByLabelText("Komentarz"), "poprawki");
    await userEvent.click(screen.getByRole("button", { name: "Zapisz zmiany (2)" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(patches).toEqual([{ url: `/api/crags/${crag.id}`, body: { approach_minutes: 50, description: "Stary opis rozszerzony", comment: "poprawki" } }]);
  });

  it("Anuluj po zmianach pyta o porzucenie", async () => {
    stubFetch(true);
    const onDone = vi.fn();
    renderWith(<CragEditForm crag={crag} onDone={onDone} />);
    await userEvent.type(await screen.findByLabelText("Nazwa"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(await screen.findByText("Porzucić zmiany?")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Wróć do edycji" }));
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await userEvent.click(screen.getByRole("button", { name: "Porzuć" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("Anuluj bez zmian wychodzi od razu", async () => {
    stubFetch(true);
    const onDone = vi.fn();
    renderWith(<CragEditForm crag={crag} onDone={onDone} />);
    await userEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe("CragPage — edycja", () => {
  it("niezalogowany nie widzi „Edytuj skałę” ani menu", async () => {
    stubFetch(false);
    renderWith(<CragPage />);
    expect(await screen.findByRole("heading", { name: crag.name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✎ Edytuj skałę" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⋯" })).not.toBeInTheDocument();
  });

  it("zalogowany widzi „Edytuj skałę” i menu „⋯”", async () => {
    stubFetch(true);
    renderWith(<CragPage />);
    expect(await screen.findByRole("button", { name: "✎ Edytuj skałę" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "⋯" })).toBeInTheDocument();
  });
});
