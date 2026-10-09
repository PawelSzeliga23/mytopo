import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMenu } from "@/components/UserMenu";
import { api } from "@/lib/api";
import { SessionProvider, useEditorMutation } from "@/lib/session";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const unauthorized = () => json({ code: "unauthorized", message: "Zaloguj się, aby edytować" }, 401);

interface Backend {
  loggedIn: boolean;
  patches: unknown[];
}

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

/** Stubs the API: /me and /login follow `backend.loggedIn`; PATCH answers 401 until the user logs in. */
function stubBackend(backend: Backend, override?: Handler) {
  const handler: Handler = (url, init) => {
    if (url === "/api/auth/me") return Promise.resolve(backend.loggedIn ? json({ nick: "ania" }) : unauthorized());
    if (url === "/api/auth/login") {
      backend.loggedIn = true;
      return Promise.resolve(json({ nick: JSON.parse(String(init?.body)).nick }));
    }
    if (init?.method === "PATCH") {
      if (!backend.loggedIn) return Promise.resolve(unauthorized());
      backend.patches.push(JSON.parse(String(init.body)));
      return Promise.resolve(json({ id: 1, changed: ["name"] }));
    }
    return Promise.resolve(json({}, 404));
  };
  const fetchMock = vi.fn((url: string, init?: RequestInit) => (override ?? handler)(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function wrap(ui: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionProvider>{ui}</SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Hasło"), "sekret");
  const nick = screen.getByLabelText(/Twój nick/);
  await user.clear(nick);
  await user.type(nick, "ania");
}

describe("pasek użytkownika", () => {
  it("niezalogowany widzi Edytuj, po zalogowaniu nick i Ostatnie zmiany", async () => {
    stubBackend({ loggedIn: false, patches: [] });
    const user = userEvent.setup();
    wrap(<UserMenu />);

    await user.click(await screen.findByRole("button", { name: "✎ Edytuj" }));
    expect(screen.getByText("Tryb edycji")).toBeInTheDocument();
    await fillLogin(user);
    await user.click(screen.getByRole("button", { name: "Wejdź" }));

    expect(await screen.findByRole("button", { name: /ania/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ostatnie zmiany" })).toHaveAttribute("href", "/zmiany");
    expect(screen.queryByRole("button", { name: "✎ Edytuj" })).not.toBeInTheDocument();
    expect(localStorage.getItem("topo-nick")).toBe("ania");
  });

  it("pokazuje błąd z API pod polami i zostawia okienko", async () => {
    const backend: Backend = { loggedIn: false, patches: [] };
    stubBackend(backend, (url) =>
      Promise.resolve(url === "/api/auth/login" ? json({ code: "wrong_password", message: "Złe hasło" }, 401) : unauthorized()),
    );
    const user = userEvent.setup();
    wrap(<UserMenu />);

    await user.click(await screen.findByRole("button", { name: "✎ Edytuj" }));
    await fillLogin(user);
    await user.click(screen.getByRole("button", { name: "Wejdź" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Złe hasło");
    expect(screen.getByLabelText("Hasło")).toHaveValue("sekret");
  });
});

function EditForm() {
  const [name, setName] = useState("Stara nazwa");
  const save = useEditorMutation((vars: { name: string }) => api.patchRoute(1, vars));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ name });
      }}
    >
      <input aria-label="Nazwa drogi" value={name} onChange={(event) => setName(event.target.value)} />
      <button type="submit">Zapisz</button>
      {save.isSuccess && <p>zapisano</p>}
    </form>
  );
}

describe("useEditorMutation", () => {
  async function typeName(user: ReturnType<typeof userEvent.setup>) {
    const input = await screen.findByLabelText("Nazwa drogi");
    await user.clear(input);
    await user.type(input, "Nowa nazwa");
    await user.click(screen.getByRole("button", { name: "Zapisz" }));
  }

  const patchCalls = (fetchMock: ReturnType<typeof stubBackend>) =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");

  it("po 401 pokazuje logowanie i po Wejdź ponawia zapis z tymi samymi danymi", async () => {
    const backend: Backend = { loggedIn: false, patches: [] };
    const fetchMock = stubBackend(backend);
    const user = userEvent.setup();
    wrap(<EditForm />);

    await typeName(user);
    expect(await screen.findByText("Tryb edycji")).toBeInTheDocument();
    await fillLogin(user);
    await user.click(screen.getByRole("button", { name: "Wejdź" }));

    expect(await screen.findByText("zapisano")).toBeInTheDocument();
    expect(backend.patches).toEqual([{ name: "Nowa nazwa" }]);
    const calls = patchCalls(fetchMock);
    expect(calls).toHaveLength(2); // the 401 and the retry carry the same body
    expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
    expect(screen.getByLabelText("Nazwa drogi")).toHaveValue("Nowa nazwa");
  });

  it("po zapisie unieważnia listy historii", async () => {
    stubBackend({ loggedIn: true, patches: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const user = userEvent.setup();
    wrap(<EditForm />, client);

    await typeName(user);
    expect(await screen.findByText("zapisano")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["changes"] });
  });

  it("po Anuluj nie ponawia i zostawia wpisane dane", async () => {
    const backend: Backend = { loggedIn: false, patches: [] };
    const fetchMock = stubBackend(backend);
    const user = userEvent.setup();
    wrap(<EditForm />);

    await typeName(user);
    await user.click(await screen.findByRole("button", { name: "Anuluj" }));

    await waitFor(() => expect(screen.queryByText("Tryb edycji")).not.toBeInTheDocument());
    expect(patchCalls(fetchMock)).toHaveLength(1);
    expect(backend.patches).toEqual([]);
    expect(screen.getByLabelText("Nazwa drogi")).toHaveValue("Nowa nazwa");
    expect(screen.queryByText("zapisano")).not.toBeInTheDocument();
  });
});
