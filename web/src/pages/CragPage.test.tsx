import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import CragPage from "@/pages/CragPage";

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string, response: Response) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));
  const router = createMemoryRouter([{ path: "/skaly/:slug", element: <CragPage /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("CragPage", () => {
  it("pokazuje nagłówek skały", async () => {
    renderAt(
      "/skaly/zabi-kon",
      new Response(
        JSON.stringify({
          id: 1, name: "Żabi Koń", slug: "zabi-kon", lng: 19.75, lat: 50.15,
          path: [
            { id: 34, name: "Jura Krakowsko Częstochowska", slug: "jura", kind: "obszar" },
            { id: 100, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region" },
          ],
          rock_type: "wapień", height_min: 10, height_max: 40, aspects: ["W", "NW"], approach_minutes: 10,
          child_friendly: true, description: null,
        }),
      ),
    );
    expect(await screen.findByRole("heading", { name: "Żabi Koń" })).toBeInTheDocument();
    expect(screen.getByText("Dolina Kobylańska")).toBeInTheDocument();
    expect(screen.getByText("wapień")).toBeInTheDocument();
    expect(screen.getByText("10–40 m")).toBeInTheDocument();
    expect(screen.getByText("W, NW")).toBeInTheDocument();
  });

  it("404 → nie znaleziono", async () => {
    renderAt("/skaly/nie-ma", new Response(JSON.stringify({ code: "not_found", message: "Nie znaleziono: skała" }), { status: 404 }));
    expect(await screen.findByText("Nie znaleziono skały")).toBeInTheDocument();
  });
});
