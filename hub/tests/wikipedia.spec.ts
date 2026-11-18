import { expect, test, type Page } from "@playwright/test";
import { servizioIn } from "./aiuti";

const voce = (page: Page) => page.frameLocator("iframe.wiki-voce");
const campo = (page: Page) => page.getByRole("combobox", { name: "Cerca in Wikipedia" });

test.describe("Wikipedia", () => {
  test("dall'hub si arriva a Wikipedia", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Wikipedia/ }).click();
    await expect(page).toHaveURL(/\/wikipedia\//);
    await expect(voce(page).locator(".mw-parser-output")).toContainText("Benvenuti su Wikipedia");
  });

  test("pagina principale nello stile dell'hub", async ({ page }) => {
    await page.goto("/wikipedia/");
    await expect(voce(page).locator(".mw-parser-output")).toContainText("Benvenuti su Wikipedia");
    await expect(page).toHaveURL(/#voce=Pagina_principale$/);
    await expect(page).toHaveTitle("Wikipedia, raspberry");
    // sulla pagina principale il titolo della voce non serve: c'è già la testata dell'hub
    await expect(voce(page).locator("h1.firstHeading")).toBeHidden();
    // la voce è trasparente (sotto c'è il pannello smerigliato) e usa i caratteri del progetto
    const stile = await voce(page)
      .locator("body")
      .evaluate((b) => ({ fondo: getComputedStyle(b).backgroundColor, caratteri: getComputedStyle(b).fontFamily }));
    expect(stile.fondo).toBe("rgba(0, 0, 0, 0)");
    expect(stile.caratteri).toContain("IBM Plex Sans");
  });

  test("suggerimenti mentre si scrive, scelta con la tastiera", async ({ page }) => {
    await page.goto("/wikipedia/");
    await campo(page).fill("gari");
    const lista = page.getByRole("listbox", { name: "Suggerimenti" });
    await expect(lista.getByRole("option", { name: "Giuseppe Garibaldi" })).toBeVisible();
    await expect(lista.getByRole("option", { name: "Garibaldi (disambigua)" })).toBeVisible();
    await expect(lista.getByRole("option", { name: "Cerca «gari» in tutte le voci" })).toBeVisible();
    await campo(page).press("ArrowDown");
    await campo(page).press("Enter");
    await expect(page).toHaveURL(/#voce=Giuseppe_Garibaldi$/);
    await expect(voce(page).locator("h1")).toHaveText("Giuseppe Garibaldi");
    await expect(page).toHaveTitle("Giuseppe Garibaldi, Wikipedia, raspberry");
  });

  test("ricerca in tutte le voci: conteggio, parole evidenziate, pagine", async ({ page }) => {
    await page.goto("/wikipedia/");
    await campo(page).fill("garibaldi");
    await campo(page).press("Enter");
    await expect(page).toHaveURL(/#cerca=garibaldi$/);
    // Kiwix scrive "11,661": l'hub lo mostra all'italiana
    await expect(page.locator(".wiki-conteggio")).toHaveText("Risultati 1-20 di 11.661 per «garibaldi»");
    const risultati = page.locator(".wiki-risultati li");
    await expect(risultati).toHaveCount(20);
    await expect(risultati.first().locator("mark").first()).toHaveText(/garibaldi/i);
    await expect(risultati.first().locator(".wiki-parole")).toHaveText(/^1\.?067 parole$/);

    await page.getByRole("button", { name: "Altri risultati" }).click();
    await expect(page).toHaveURL(/#cerca=garibaldi&da=20$/);
    await expect(page.locator(".wiki-conteggio")).toHaveText("Risultati 21-40 di 11.661 per «garibaldi»");
    await page.goBack();
    await expect(page.locator(".wiki-conteggio")).toHaveText("Risultati 1-20 di 11.661 per «garibaldi»");
  });

  test("una ricerca lanciata mentre la voce si carica tiene il suo indirizzo", async ({ page }) => {
    // il Raspberry e' lento: la pagina principale arriva dopo che si e' gia' cercato qualcosa
    await page.route("**/wiki/content/**", async (route) => {
      await new Promise((ok) => setTimeout(ok, 1500));
      await route.continue();
    });
    await page.goto("/wikipedia/");
    await campo(page).fill("garibaldi");
    await campo(page).press("Enter");
    await expect(page.locator(".wiki-conteggio")).toBeVisible();
    await expect(page.locator("iframe.wiki-voce")).toBeAttached();
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(/#cerca=garibaldi$/);
    await expect(page.locator(".wiki-conteggio")).toBeVisible();
  });

  test("Esc chiude i suggerimenti ma lascia il testo", async ({ page }) => {
    await page.goto("/wikipedia/");
    await campo(page).fill("gari");
    await expect(page.getByRole("listbox", { name: "Suggerimenti" })).toBeVisible();
    await campo(page).press("Escape");
    await expect(page.getByRole("listbox", { name: "Suggerimenti" })).toBeHidden();
    await expect(campo(page)).toHaveValue("gari");
  });

  test("ricerca senza risultati", async ({ page }) => {
    await page.goto("/wikipedia/");
    await campo(page).fill("zzzqqq");
    await campo(page).press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Nessuna voce contiene «zzzqqq»" })).toBeVisible();
  });

  test("da un risultato alla voce, poi un collegamento interno", async ({ page }) => {
    await page.goto("/wikipedia/#cerca=garibaldi");
    await page.getByRole("button", { name: "Giuseppe Garibaldi", exact: true }).click();
    await expect(page).toHaveURL(/#voce=Giuseppe_Garibaldi$/);
    await expect(voce(page).locator("h1")).toHaveText("Giuseppe Garibaldi");

    await voce(page).getByRole("link", { name: "Nizza" }).click();
    await expect(page).toHaveURL(/#voce=Nizza$/);
    await expect(voce(page).locator("h1")).toHaveText("Nizza");
    await expect(page).toHaveTitle("Nizza, Wikipedia, raspberry");
    await expect(page.locator(".wiki-foglio")).toHaveAttribute("aria-busy", "false");

    await page.goBack();
    await expect(voce(page).locator("h1")).toHaveText("Giuseppe Garibaldi");
  });

  test("la voce prende l'altezza del contenuto: scorre la pagina, non un riquadro", async ({ page }) => {
    await page.goto("/wikipedia/#voce=Roma");
    await expect(voce(page).locator("h1")).toHaveText("Roma");
    await expect
      .poll(() =>
        page.locator("iframe.wiki-voce").evaluate((f: HTMLIFrameElement) => {
          const interna = f.contentDocument?.documentElement.scrollHeight ?? 0;
          return Math.abs(f.offsetHeight - interna) <= 2 && interna > window.innerHeight;
        }),
      )
      .toBe(true);
    const scorre = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 200);
    expect(scorre).toBe(true);
  });

  test("voce a caso", async ({ page }) => {
    await page.goto("/wikipedia/");
    await expect(voce(page).locator(".mw-parser-output")).toContainText("Benvenuti");
    await page.getByRole("button", { name: "Voce a caso" }).click();
    await expect(page).toHaveURL(/#voce=Roma$/);
    await expect(voce(page).locator("h1")).toHaveText("Roma");
  });

  test.describe("con il tema scuro del browser", () => {
    test.use({ colorScheme: "dark" });

    test("la voce segue il tema dell'hub, anche quando si cambia", async ({ page }) => {
      await page.goto("/wikipedia/#voce=Galileo_Galilei");
      await expect(voce(page).locator("h1")).toHaveText("Galileo Galilei");
      await expect(voce(page).locator("html")).toHaveClass(/skin-theme-clientpref-night/);
      await expect(voce(page).locator("body")).toHaveCSS("color", "rgb(243, 245, 241)");

      await page.getByRole("button", { name: "Tema: chiaro" }).click();
      await expect(voce(page).locator("html")).toHaveClass(/skin-theme-clientpref-day/);
      await expect(voce(page).locator("body")).toHaveCSS("color", "rgb(22, 32, 26)");
    });
  });

  test("Wikipedia spenta: spiega cosa fare e riporta all'hub", async ({ page }) => {
    await servizioIn(page, "wikipedia", "spento");
    await page.goto("/wikipedia/");
    await expect(page.getByRole("heading", { name: "Wikipedia è spenta" })).toBeVisible();
    await expect(page.locator("iframe.wiki-voce")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Voce a caso" })).toBeDisabled();
    await page.getByRole("link", { name: "Torna all'hub" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
