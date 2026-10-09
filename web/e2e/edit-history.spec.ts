import { expect, test } from "@playwright/test";

test("logowanie → zmiana wyceny → historia → cofnięcie", async ({ page, request }) => {
  // Skała z fixture importu; gdy jej brak w bazie — pierwsza skała z drogami.
  const crags = (await (await request.get("/api/map/crags")).json()).features;
  const crag = crags.find((f: { properties: { slug: string } }) => f.properties.slug === "zabi-kon") ?? crags.find((f: { properties: { route_count: number } }) => f.properties.route_count > 0);
  await page.goto(`/skaly/${crag.properties.slug}`);
  await page.getByRole("button", { name: "✎ Edytuj" }).click();
  await page.getByLabel("Hasło").fill(process.env.EDIT_PASSWORD ?? "e2e-haslo");
  await page.getByLabel(/Twój nick/).fill("e2e");
  await page.getByRole("button", { name: "Wejdź" }).click();
  // Wiersz drogi: <li> z przyciskiem ✎ (jest rodzeństwem przycisku wiersza); po nazwie, bo kolejność może się zmienić.
  const edit = page.getByRole("button", { name: /Edytuj drogę/ }).first();
  const routeName = ((await edit.getAttribute("aria-label")) ?? "").replace("Edytuj drogę ", "");
  const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Edytuj drogę ${routeName}` }) });
  const oldGrade = (await row.getByTestId("grade").textContent()) ?? "";
  await edit.click();
  await page.getByLabel("Wycena").fill("VI.5");
  await page.getByRole("button", { name: "Zapisz" }).click();
  await expect(row.getByTestId("grade")).toContainText("VI.5");
  await page.getByRole("button", { name: "⋯" }).click();
  await page.getByRole("menuitem", { name: "Historia" }).click();
  const entry = page.getByTestId("change-entry").first();
  await expect(entry).toContainText("e2e");
  await entry.getByRole("button", { name: "↶ Cofnij" }).click();
  await expect(row.getByTestId("grade")).toHaveText(oldGrade);
});
