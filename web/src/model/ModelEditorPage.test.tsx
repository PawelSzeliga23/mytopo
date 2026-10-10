import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { encode } from "fast-png";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { makeCrag, makeWall } from "@/test/fixtures";
import { Stroke } from "./grid";
import type { ModelCanvasProps } from "./ModelCanvas";
import ModelEditorPage from "./ModelEditorPage";

// WebGL is not available in jsdom: the canvas is a button that "drags" the eraser over the model.
vi.mock("./ModelCanvas", () => ({
  ModelCanvas: (props: ModelCanvasProps) => (
    <button
      type="button"
      onClick={() => {
        const stroke = new Stroke(props.grid);
        stroke.apply("erase", 3, 3, 1);
        const patch = stroke.finish();
        if (patch) props.onStroke(patch);
      }}
    >
      pociągnij gumką
    </button>
  ),
}));

const W = 20;
const H = 15;
const depthPng = () => new Uint8Array(encode({ width: W, height: H, data: new Uint16Array(W * H).fill(30000), depth: 16, channels: 1 }));
const segmentsPng = () => new Uint8Array(encode({ width: W, height: H, data: new Uint8Array(W * H).fill(3), depth: 8, channels: 1 }));

const wall = makeWall(5, [], {
  depth_status: "ready",
  depth_url: "/media/walls/5/1/depth.png",
  segments_url: "/media/walls/5/1/segments.png",
  original_depth_url: "/media/walls/5/1/depth.png",
  original_segments_url: "/media/walls/5/1/segments.png",
});
const crag = makeCrag([wall], []);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Call {
  url: string;
  form: FormData;
}

function stubFetch(reply: (call: Call, n: number) => Response = () => json({ model_version: 1, changed: ["model_path"] })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return Promise.resolve(json({ nick: "ania" }));
      if (url.endsWith("depth.png")) return Promise.resolve(new Response(depthPng()));
      if (url.endsWith("segments.png")) return Promise.resolve(new Response(segmentsPng()));
      if (init?.method === "PUT") {
        const call = { url, form: init.body as FormData };
        calls.push(call);
        return Promise.resolve(reply(call, calls.length));
      }
      return Promise.resolve(json(crag));
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/skaly/${crag.slug}/model/${wall.id}`]}>
          <SessionProvider>
            <Routes>
              <Route path="/skaly/:slug/model/:wallId" element={<ModelEditorPage />} />
              <Route path="/skaly/:slug" element={<p>STRONA SKAŁY</p>} />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function saveWith(comment = "") {
  await userEvent.click(screen.getByRole("button", { name: /^Zapisz/ }));
  if (comment) await userEvent.type(screen.getByLabelText("Komentarz"), comment);
  await userEvent.click(screen.getAllByRole("button", { name: "Zapisz" }).at(-1)!);
}

afterEach(() => vi.unstubAllGlobals());

describe("ModelEditorPage", () => {
  it("counts steps, undoes and redoes them", async () => {
    stubFetch();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "pociągnij gumką" }));
    expect(screen.getByRole("button", { name: "Zapisz (1 zmiana)" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Wygładź" })); // flat model: nothing to smooth, no step
    await userEvent.click(screen.getByRole("button", { name: "Przytnij krawędź" }));
    expect(screen.getByRole("button", { name: "Zapisz (2 zmiany)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cofnij" }));
    await userEvent.click(screen.getByRole("button", { name: "Cofnij" }));
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    await userEvent.keyboard("{Control>}y{/Control}");
    expect(screen.getByRole("button", { name: "Zapisz (1 zmiana)" })).toBeInTheDocument();
  });

  it("saves the baked model with its base version, then counts from the checkpoint", async () => {
    const calls = stubFetch();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "pociągnij gumką" }));
    await saveWith("bez drzewa");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const { url, form } = calls[0];
    expect(url).toBe(`/api/walls/${wall.id}/model`);
    expect(form.get("base_model")).toBe("");
    expect(form.get("base_photo")).toBe(wall.image_url);
    expect(form.get("comment")).toBe("bez drzewa");
    expect(form.get("depth")).toBeInstanceOf(Blob);
    expect(form.get("segments")).toBeInstanceOf(Blob);
    expect(form.has("rock_color")).toBe(false);
    expect(await screen.findByRole("button", { name: "Zapisz" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "pociągnij gumką" })); // erasing erased nodes: no step
    await userEvent.click(screen.getByRole("button", { name: "Przytnij krawędź" }));
    await saveWith();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].form.get("base_model")).toBe("1");
  });

  it("saves only the settings when the model was not touched", async () => {
    const calls = stubFetch(() => json({ model_version: null, changed: ["depth_enabled"] }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "nigdy" }));
    await saveWith();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const { form } = calls[0];
    expect(form.get("depth_enabled")).toBe("off");
    expect(form.has("depth")).toBe(false);
  });

  it("on a conflict, 'Nadpisz moim' saves again on top of the newer model", async () => {
    const calls = stubFetch((_, n) =>
      n === 1 ? json({ code: "model_conflict", message: "Ktoś zapisał model w międzyczasie", current_model: 4 }, 409) : json({ model_version: 5, changed: ["model_path"] }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "pociągnij gumką" }));
    await saveWith();
    await userEvent.click(await screen.findByRole("button", { name: "Nadpisz moim" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].form.get("base_model")).toBe("4");
    expect(calls[1].form.get("depth")).toBeInstanceOf(Blob);
  });

  it("asks before leaving with unsaved changes", async () => {
    stubFetch();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "pociągnij gumką" }));
    await userEvent.click(screen.getByRole("button", { name: "Wyjdź z edytora" }));
    expect(screen.getByText("Porzucić zmiany?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wyjdź" }));
    expect(await screen.findByText("STRONA SKAŁY")).toBeInTheDocument();
  });
});
