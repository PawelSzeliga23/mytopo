import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeOut } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import ChangesPage from "./ChangesPage";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const change: ChangeOut = {
  id: 12, author: "bartek", comment: null, issued_at: new Date().toISOString(), is_import: false, reverts_id: null, reverted_by: null,
  crag: { id: 44, name: "Żabi Koń", slug: "zabi-kon" }, area_path: [{ id: 1, name: "Jura", slug: "jura", kind: "obszar" }],
  objects: [{ kind: "route", id: 7, name: "Filar", op: "updated", summary: null, diffs: [{ field: "grade", before: "VI+", after: "VI.1" }] }],
};

afterEach(() => vi.unstubAllGlobals());

interface Post {
  url: string;
  body: unknown;
}

function stubFetch({ loggedIn = true, revertReply }: { loggedIn?: boolean; revertReply?: () => Response } = {}) {
  const urls: string[] = [];
  const posts: Post[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return Promise.resolve(json({ nick: loggedIn ? "ania" : null }));
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(revertReply ? revertReply() : json({ transaction_id: 13 }));
      }
      urls.push(url);
      return Promise.resolve(json({ items: [change], next_before: null }));
    }),
  );
  return { urls, posts };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionProvider>
            <ChangesPage />
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("ChangesPage", () => {
  it("niezalogowany widzi zmiany, ale bez cofania", async () => {
    stubFetch({ loggedIn: false });
    renderPage();
    expect(await screen.findByTestId("change-entry")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cofnij|Przywróć/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✎ Edytuj" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ostatnie zmiany" })).toBeInTheDocument();
  });

  it("filtr „tylko usunięcia” prosi o kind=deleted", async () => {
    const { urls } = stubFetch();
    renderPage();
    expect(await screen.findByTestId("change-entry")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "tylko usunięcia" }));
    await vi.waitFor(() => expect(urls.some((url) => url.includes("kind=deleted"))).toBe(true));
  });

  it("konflikt przy cofaniu pokazuje okienko, a „bez konfliktu” wysyła tryb safe", async () => {
    let calls = 0;
    const conflicts = [{ kind: "route", id: 7, name: "Filar", field: "grade", author: "kuba", issued_at: change.issued_at, current: "VI.1", restored: "VI+" }];
    const { posts } = stubFetch({
      revertReply: () => (calls++ === 0 ? json({ code: "revert_conflict", message: "Część pól zmieniono później", conflicts }, 409) : json({ transaction_id: 14 })),
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "↶ Cofnij" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cofnij tylko bez konfliktu" }));
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[0]).toEqual({ url: "/api/changes/12/revert", body: {} });
    expect(posts[1]).toEqual({ url: "/api/changes/12/revert", body: { mode: "safe" } });
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Cofnij tylko bez konfliktu" })).not.toBeInTheDocument());
  });
});
