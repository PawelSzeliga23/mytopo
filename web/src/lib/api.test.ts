import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, getJson, sendJson } from "@/lib/api";

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

describe("sendJson", () => {
  it("wysyła JSON z ciasteczkiem sesji, a 204 daje undefined", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(sendJson("DELETE", "/api/routes/3")).resolves.toBeUndefined();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init).toMatchObject({ method: "DELETE", credentials: "same-origin" });

    stubFetch(new Response(JSON.stringify({ id: 3, changed: ["name"] })));
    await expect(sendJson("PATCH", "/api/routes/3", { name: "Nowa" })).resolves.toEqual({ id: 3, changed: ["name"] });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nowa" }),
    });
  });

  it("409 daje ApiError z kodem i całą odpowiedzią", async () => {
    const conflicts = [{ kind: "route", id: 3, name: "Pikuś", field: "grade", author: "ania", issued_at: null, current: "VI", restored: "V" }];
    stubFetch(new Response(JSON.stringify({ code: "revert_conflict", message: "Część pól zmieniono później", conflicts }), { status: 409 }));
    const error = await sendJson("POST", "/api/changes/9/revert").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "revert_conflict", message: "Część pól zmieniono później" });
    expect((error as ApiError).body).toMatchObject({ conflicts });
  });
});

describe("api", () => {
  it("DELETE niesie komentarz w zapytaniu, a changes pomija puste parametry", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await api.deleteCrag(5, "literówka & bałagan");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/crags/5?comment=liter%C3%B3wka%20%26%20ba%C5%82agan");

    stubFetch(new Response(JSON.stringify({ items: [], next_before: null })));
    await api.changes({ crag: 7, include_import: true });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/changes?crag=7&include_import=true");
  });
});
