import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// EDIT_PASSWORD z otoczenia, a gdy go brak — z ../.env (to samo hasło, które dostaje API).
function editPassword(): string {
  if (process.env.EDIT_PASSWORD) return process.env.EDIT_PASSWORD;
  try {
    const line = readFileSync(new URL("../../.env", import.meta.url), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("EDIT_PASSWORD="));
    if (line) return line.slice("EDIT_PASSWORD=".length).trim();
  } catch {
    // brak .env: zostaje wartość z README
  }
  return "e2e-haslo";
}

test("logowanie → zmiana wyceny → historia → cofnięcie", async ({ page, request }) => {
  const password = editPassword();
  const comment = `e2e-${Date.now()}`;
  // Skała z fixture importu; gdy jej brak w bazie — pierwsza skała z drogami.
  const crags = (await (await request.get("/api/map/crags")).json()).features;
  const crag = crags.find((f: { properties: { slug: string } }) => f.properties.slug === "zabi-kon") ?? crags.find((f: { properties: { route_count: number } }) => f.properties.route_count > 0);
  let reverted = false;
  try {
    await page.goto(`/skaly/${crag.properties.slug}`);
    await page.getByRole("button", { name: "Edytuj", exact: true }).click();
    await page.getByLabel("Hasło").fill(password);
    await page.getByLabel(/Twój nick/).fill("e2e");
    await page.getByRole("button", { name: "Wejdź" }).click();
    // Wiersz drogi: <li> z przyciskiem ✎ (rodzeństwo przycisku wiersza); po nazwie, bo kolejność może się zmienić.
    const edit = page.getByRole("button", { name: /Edytuj drogę/ }).first();
    const routeName = ((await edit.getAttribute("aria-label")) ?? "").replace("Edytuj drogę ", "");
    const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Edytuj drogę ${routeName}` }) });
    const oldGrade = (await row.getByTestId("grade").textContent()) ?? "";
    const newGrade = oldGrade.startsWith("VI.5") ? "VI.4" : "VI.5";
    await edit.click();
    await page.getByLabel("Wycena").fill(newGrade);
    await page.getByLabel("Komentarz").fill(comment);
    await page.getByRole("button", { name: "Zapisz" }).click();
    await expect(row.getByTestId("grade")).toContainText(newGrade);
    await page.getByRole("button", { name: "⋯" }).click();
    await page.getByRole("menuitem", { name: "Historia" }).click();
    const entry = page.getByTestId("change-entry").filter({ hasText: comment });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText("e2e");
    await entry.getByRole("button", { name: "↶ Cofnij" }).click();
    await expect(row.getByTestId("grade")).toHaveText(oldGrade);
    reverted = true;
  } finally {
    // Przerwany przebieg nie zostawia zmienionej wyceny: cofnij przez API, jeśli zmiana nadal obowiązuje.
    if (!reverted) {
      await request.post("/api/auth/login", { data: { password, nick: "e2e" } });
      const page1 = await (await request.get(`/api/changes?crag=${crag.properties.id}`)).json();
      const tx = page1.items.find((item: { comment: string | null; reverted_by: unknown }) => item.comment === comment && !item.reverted_by);
      if (tx) await request.post(`/api/changes/${tx.id}/revert`, { data: { mode: "all" } });
    }
  }
});
