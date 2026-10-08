import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJson } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response | Error) {
  vi.stubGlobal("fetch", vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))));
}

describe("getJson", () => {
  it("zwraca JSON", async () => {
    stubFetch(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(getJson("/api/x")).resolves.toEqual({ ok: 1 });
  });

  it("przekazuje polski komunikat z API", async () => {
    stubFetch(new Response(JSON.stringify({ code: "not_found", message: "Nie znaleziono: skała" }), { status: 404 }));
    await expect(getJson("/api/crags/x")).rejects.toMatchObject({ status: 404, message: "Nie znaleziono: skała" });
  });

  it("ma komunikat zastępczy dla odpowiedzi bez JSON", async () => {
    stubFetch(new Response("<html>", { status: 502 }));
    await expect(getJson("/api/x")).rejects.toMatchObject({ status: 502, message: "Błąd serwera (502)" });
  });

  it("zgłasza brak połączenia", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = await getJson("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, message: "Brak połączenia z serwerem" });
  });
});
