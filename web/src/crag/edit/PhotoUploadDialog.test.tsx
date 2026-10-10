import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { makeCrag, makeWall } from "@/test/fixtures";
import { MAX_PHOTO_BYTES, PhotoUploadDialog } from "./PhotoUploadDialog";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const wall = makeWall(5, []);
const crag = makeCrag([wall], []);

interface Call {
  method: string;
  url: string;
  body: BodyInit | null | undefined;
}

function stubFetch(reply: (call: Call) => Response = () => json({ id: 42, version: 1 }, 201)) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return Promise.resolve(json({ nick: "ania" }));
      if (init?.method && init.method !== "GET") {
        const call = { method: init.method, url, body: init.body };
        calls.push(call);
        return Promise.resolve(reply(call));
      }
      return Promise.resolve(json(crag));
    }),
  );
  return calls;
}

function renderDialog(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/skaly/${crag.slug}`]}>
          <SessionProvider>
            <Routes>
              <Route path="/skaly/:slug" element={ui} />
              <Route path="/skaly/:slug/topo/:wallId" element={<p>EDYTOR</p>} />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const photo = (size = 1000) => {
  const file = new File(["x"], "sciana.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:podglad");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PhotoUploadDialog", () => {
  it("dodaje ścianę i otwiera jej edytor topo", async () => {
    const calls = stubFetch();
    renderDialog(<PhotoUploadDialog crag={crag} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Dodaj ścianę" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wyślij" })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText(/Zdjęcie/), photo());
    expect(screen.getByAltText("Podgląd zdjęcia")).toHaveAttribute("src", "blob:podglad");
    await userEvent.type(screen.getByLabelText(/Nazwa ściany/), " Lewa ");
    await userEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(await screen.findByText("EDYTOR")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect([call.method, call.url]).toEqual(["POST", `/api/crags/${crag.id}/walls`]);
    const form = call.body as FormData;
    expect(form.get("name")).toBe("Lewa");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.has("comment")).toBe(false);
  });

  it("odrzuca zdjęcie większe niż 30 MB bez wysyłania", async () => {
    const calls = stubFetch();
    renderDialog(<PhotoUploadDialog crag={crag} onClose={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText(/Zdjęcie/), photo(MAX_PHOTO_BYTES + 1));
    expect(screen.getByRole("alert")).toHaveTextContent("Zdjęcie jest większe niż 30 MB");
    expect(screen.getByRole("button", { name: "Wyślij" })).toBeDisabled();
    expect(calls).toEqual([]);
  });

  it("podmienia zdjęcie ściany", async () => {
    const calls = stubFetch(() => json({ id: wall.id, version: 1 }));
    renderDialog(<PhotoUploadDialog crag={crag} wall={wall} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Podmień zdjęcie" })).toBeInTheDocument();
    expect(screen.getByText(/Linie dróg zostaną/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nazwa ściany/)).not.toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText(/Zdjęcie/), photo());
    await userEvent.type(screen.getByLabelText(/Komentarz/), "ostrzejsze");
    await userEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(await screen.findByText("EDYTOR")).toBeInTheDocument();
    expect([calls[0].method, calls[0].url]).toEqual(["PUT", `/api/walls/${wall.id}/image`]);
    expect((calls[0].body as FormData).get("comment")).toBe("ostrzejsze");
  });

  it("błąd serwera zostawia okno otwarte", async () => {
    stubFetch(() => json({ code: "invalid_image", message: "Nieprawidłowy plik obrazu" }, 422));
    const error = vi.spyOn(toast, "error");
    const onClose = vi.fn();
    renderDialog(<PhotoUploadDialog crag={crag} onClose={onClose} />);
    await userEvent.upload(screen.getByLabelText(/Zdjęcie/), photo());
    await userEvent.click(screen.getByRole("button", { name: "Wyślij" }));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Nieprawidłowy plik obrazu"));
    expect(screen.getByRole("button", { name: "Wyślij" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("EDYTOR")).not.toBeInTheDocument();
  });
});
