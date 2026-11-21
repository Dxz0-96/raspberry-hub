import { LOCALES } from "../lib/messages";
import { expect, test } from "./helpers";

// The hub speaks the language of the browser: there is no switch in the page.

test.describe("Italian browser", () => {
  test.use({ locale: "it-IT" });

  test("gets the hub in Italian", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    const services = page.getByRole("region", { name: "Servizi" });
    await expect(services.getByRole("link", { name: /^Mappe, Aggiornate il 16 novembre/ })).toBeVisible();
    await expect(services.getByRole("link", { name: /^Wikipedia, Edizione di agosto 2026/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aggiungi servizio" })).toBeVisible();
    await expect(page.getByText("Ultime 24 ore: 27.844 richieste, 13.559 bloccate.", { exact: false })).toBeVisible();
    await expect(page.getByText(/acceso da 1 g \d+ h/)).toBeVisible();
  });

  test("Italian numbers and quotes in Wikipedia", async ({ page }) => {
    await page.goto("/wikipedia/#search=garibaldi");
    await expect(page.locator(".wiki-count")).toHaveText("Risultati 1-20 di 11.661 per «garibaldi»");
  });

  test("the map page is in Italian too", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Mappe/ }).click();
    await expect(page.getByRole("combobox", { name: "Cerca un indirizzo o una località" })).toBeVisible();
    await expect(page).toHaveTitle("Mappe, raspberry");
    await expect(page.getByRole("button", { name: "Avvicina" })).toBeVisible();
  });

  test("no language switch, and a choice saved by an older version no longer counts", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "English" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Lingua" })).toHaveCount(0);
    // versions up to 2.2 saved the EN / IT choice here
    await page.evaluate(() => localStorage.setItem("language", "en"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    await expect(page.getByRole("button", { name: "Aggiungi servizio" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("language"))).toBeNull();
  });

  test("follows the browser when its languages change", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Aggiungi servizio" })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "languages", { get: () => ["de-DE", "en"], configurable: true });
      window.dispatchEvent(new Event("languagechange"));
    });
    await expect(page.getByRole("button", { name: "Dienst hinzufügen" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });
});

test.describe("Spanish browser", () => {
  test.use({ locale: "es-ES" });

  test("gets the hub in Spanish, with Spanish numbers and dates", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    const services = page.getByRole("region", { name: "Servicios" });
    await expect(services.getByRole("link", { name: /^Mapas, Actualizados el 16 de noviembre/ })).toBeVisible();
    await expect(services.getByRole("link", { name: /^Wikipedia, Edición de agosto de 2026/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Añadir servicio" })).toBeVisible();
    await expect(page.getByText("Últimas 24 horas: 27.844 consultas, 13.559 bloqueadas.", { exact: false })).toBeVisible();
    await page.goto("/wikipedia/#search=garibaldi");
    await expect(page.locator(".wiki-count")).toHaveText("Resultados 1-20 de 11.661 para «garibaldi»");
  });
});

test.describe("French browser (Switzerland)", () => {
  test.use({ locale: "fr-CH" });

  test("gets the hub in French, with French numbers, dates and units", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const services = page.getByRole("region", { name: "Services" });
    await expect(services.getByRole("link", { name: /^Cartes, Mises à jour le 16 novembre/ })).toBeVisible();
    await expect(services.getByRole("link", { name: /^Wikipédia, Édition d'août 2026/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ajouter un service" })).toBeVisible();
    await expect(page.getByText(/Dernières 24 heures : 27\s844 requêtes, 13\s559 bloquées\./)).toBeVisible();
    await expect(page.getByText(/allumé depuis 1 j \d+ h/)).toBeVisible();
    await expect(page.locator(".legend-value").first()).toHaveText(/ Go$/);
  });
});

test.describe("German browser", () => {
  test.use({ locale: "de-DE" });

  test("gets the hub in German, with German numbers and dates", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const services = page.getByRole("region", { name: "Dienste" });
    await expect(services.getByRole("link", { name: /^Karten, Aktualisiert am 16\. November/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dienst hinzufügen" })).toBeVisible();
    await expect(page.getByText("Letzte 24 Stunden: 27.844 Anfragen, 13.559 blockiert.", { exact: false })).toBeVisible();
    await page.goto("/wikipedia/#search=garibaldi");
    await expect(page.locator(".wiki-count")).toHaveText("Ergebnisse 1-20 von 11.661 für „garibaldi“");
  });
});

test.describe("Browser in a language the hub does not speak", () => {
  test.use({ locale: "pt-BR" });

  test("gets the hub in English", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Add service" })).toBeVisible();
  });
});

test("every dictionary has the keys of the English one, error and state codes included", () => {
  /** Every key path, functions included as leaves ("services.details.no_response") */
  const keys = (value: unknown, prefix = ""): string[] =>
    value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, prefix ? `${prefix}.${key}` : key))
      : [prefix];
  const english = keys(LOCALES[0].messages).sort();
  for (const { code, messages } of LOCALES) {
    expect(keys(messages).sort(), code).toEqual(english);
  }
});
