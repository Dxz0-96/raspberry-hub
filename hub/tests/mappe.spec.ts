import { expect, test } from "@playwright/test";
import { posizione, servizioIn } from "./aiuti";

const campo = "Cerca un indirizzo o una località";

test.describe("Mappe", () => {
  test("dall'hub si arriva alla mappa", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Mappe/ }).click();
    await expect(page).toHaveURL(/\/mappe\/$/);
    await expect(page.getByRole("combobox", { name: campo })).toBeVisible();
  });

  test("la mappa si disegna con i dati offline del Raspberry", async ({ page }) => {
    const tessere = page.waitForResponse((r) => r.url().includes("/tiles/italia.pmtiles") && r.status() === 206);
    await page.goto("/mappe/");
    await tessere;
    const tela = page.locator(".maplibregl-canvas");
    await expect(tela).toBeVisible();
    const riquadro = await tela.boundingBox();
    expect(riquadro?.width).toBeGreaterThan(300);
    expect(riquadro?.height).toBeGreaterThan(300);
    // l'indirizzo ricorda la posizione: si parte dall'Italia intera
    await expect.poll(() => posizione(page.url())?.zoom ?? 99).toBeLessThan(7);
    await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");
  });

  test("cerca un luogo e porta la mappa lì, con il segnaposto", async ({ page }) => {
    await page.goto("/mappe/");
    const ricerca = page.getByRole("combobox", { name: campo });
    await ricerca.fill("roma lazio");
    const elenco = page.getByRole("listbox", { name: "Risultati" });
    await expect(elenco.getByRole("option")).toHaveCount(1);
    await expect(elenco.getByRole("option").first()).toContainText("Roma");
    await ricerca.press("Enter");
    await expect(elenco).toBeHidden();
    await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
    await expect
      .poll(() => {
        const qui = posizione(page.url());
        return Boolean(qui && Math.abs(qui.lat - 41.89) < 0.2 && Math.abs(qui.lon - 12.48) < 0.3 && qui.zoom > 8);
      })
      .toBe(true);
  });

  test("con la tastiera si sceglie il secondo risultato, un numero civico", async ({ page }) => {
    await page.goto("/mappe/");
    const ricerca = page.getByRole("combobox", { name: campo });
    await ricerca.fill("garibaldi milano");
    const opzioni = page.getByRole("listbox", { name: "Risultati" }).getByRole("option");
    await expect(opzioni).toHaveCount(2);
    await ricerca.press("ArrowDown");
    await expect(opzioni.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(ricerca).toHaveAttribute("aria-activedescendant", (await opzioni.nth(1).getAttribute("id")) ?? "");
    await ricerca.press("Enter");
    await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
    await expect.poll(() => posizione(page.url())?.zoom ?? 0).toBeGreaterThan(16);
    await expect.poll(() => posizione(page.url())?.lat.toFixed(2)).toBe("45.47");
  });

  test("ricerca senza risultati: dice cosa provare", async ({ page }) => {
    await page.goto("/mappe/");
    await page.getByRole("combobox", { name: campo }).fill("via inesistente xyz");
    await expect(page.getByRole("status").filter({ hasText: "Nessun risultato" })).toBeVisible();
  });

  test("Esc chiude i risultati, la x svuota il campo", async ({ page }) => {
    await page.goto("/mappe/");
    const ricerca = page.getByRole("combobox", { name: campo });
    await ricerca.fill("milano");
    await expect(page.getByRole("listbox", { name: "Risultati" })).toBeVisible();
    await ricerca.press("Escape");
    await expect(page.getByRole("listbox", { name: "Risultati" })).toBeHidden();
    await expect(ricerca).toHaveValue("milano");
    await page.getByRole("button", { name: "Cancella la ricerca" }).click();
    await expect(ricerca).toHaveValue("");
  });

  test("mappe spente: lo dice e non disegna la mappa", async ({ page }) => {
    await page.route("**/tiles/italia.pmtiles", (route) => route.fulfill({ status: 503, body: "Mappe spente dall'hub" }));
    await page.goto("/mappe/");
    await expect(page.getByRole("heading", { name: "Le mappe sono spente" })).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  });

  test("mappe non ancora scaricate", async ({ page }) => {
    await page.route("**/tiles/italia.pmtiles", (route) => route.fulfill({ status: 404 }));
    await servizioIn(page, "mappe", "mancante");
    await page.goto("/mappe/");
    await expect(page.getByRole("heading", { name: "Le mappe non sono ancora state scaricate" })).toBeVisible();
  });
});
