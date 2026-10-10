import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallOut } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { makeWall } from "@/test/fixtures";
import { DepthStatus } from "./DepthStatus";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubFetch(loggedIn: boolean) {
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return Promise.resolve(loggedIn ? json({ nick: "ania" }) : json({ code: "unauthorized", message: "x" }, 401));
      if (init?.method && init.method !== "GET") writes.push(`${init.method} ${url}`);
      return Promise.resolve(json({ queued: true }, 202));
    }),
  );
  return writes;
}

function renderStatus(wall: WallOut) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionProvider>
            <DepthStatus wall={wall} />
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("DepthStatus", () => {
  it("pokazuje, że model 2.5D się liczy", () => {
    stubFetch(false);
    renderStatus(makeWall(1, [], { depth_status: "pending" }));
    expect(screen.getByTestId("depth-status")).toHaveTextContent("Model 2.5D w przygotowaniu");
  });

  it("po błędzie zalogowany może ponowić", async () => {
    const writes = stubFetch(true);
    renderStatus(makeWall(3, [], { depth_status: "failed" }));
    expect(screen.getByTestId("depth-status")).toHaveTextContent("Nie udało się policzyć 2.5D");
    await userEvent.click(await screen.findByRole("button", { name: "Ponów" }));
    await vi.waitFor(() => expect(writes).toEqual(["POST /api/walls/3/depth"]));
  });

  it("niezalogowany nie widzi „Ponów”", async () => {
    stubFetch(false);
    renderStatus(makeWall(3, [], { depth_status: "failed" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Ponów" })).not.toBeInTheDocument();
  });

  it("gotowa głębia albo brak zdjęcia — nic", () => {
    stubFetch(false);
    const { container } = renderStatus(makeWall(1, [], { depth_status: "ready" }));
    expect(container).toBeEmptyDOMElement();
    renderStatus(makeWall(2, [], { image_url: null }));
    expect(screen.queryByTestId("depth-status")).not.toBeInTheDocument();
  });
});
