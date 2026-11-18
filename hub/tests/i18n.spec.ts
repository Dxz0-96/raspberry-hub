import { expect, test } from "./helpers";

test.describe("Italian browser", () => {
  test.use({ locale: "it-IT" });

  test("gets the hub in Italian", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    const services = page.getByRole("region", { name: "Servizi" });
    await expect(services.getByRole("link", { name: /^Mappe, Aggiornate il 16 novembre/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aggiungi servizio" })).toBeVisible();
    await expect(page.getByText("Ultime 24 ore: 27.844 richieste, 13.559 bloccate.", { exact: false })).toBeVisible();
  });

  test("Italian numbers and quotes in Wikipedia", async ({ page }) => {
    await page.goto("/wikipedia/#search=garibaldi");
    await expect(page.locator(".wiki-count")).toHaveText("Risultati 1-20 di 11.661 per «garibaldi»");
  });

  test("the chosen language stays on this device", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("button", { name: "Add service" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.getByRole("button", { name: "Add service" })).toBeVisible();
    await page.goto("/maps/");
    await expect(page).toHaveTitle("Maps, raspberry");
  });
});

test.describe("English browser", () => {
  test("switching to Italian translates the map page too", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Italiano" }).click();
    await expect(page.getByRole("button", { name: "Aggiungi servizio" })).toBeVisible();
    // through the hub, as a person would: a page.goto() right after the click can beat the browser to
    // saving the choice (the reload in the test above covers that it is saved)
    await page.getByRole("link", { name: /^Mappe/ }).click();
    await expect(page.getByRole("combobox", { name: "Cerca un indirizzo o una località" })).toBeVisible();
    await expect(page).toHaveTitle("Mappe, raspberry");
    await expect(page.getByRole("button", { name: "Avvicina" })).toBeVisible();
  });
});
