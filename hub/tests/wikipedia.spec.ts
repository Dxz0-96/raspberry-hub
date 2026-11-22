import type { Page } from "@playwright/test";
import { expect, serviceIn, test } from "./helpers";

const article = (page: Page) => page.frameLocator("iframe.wiki-article");
const field = (page: Page) => page.getByRole("combobox", { name: "Search Wikipedia" });
const frameBook = (page: Page) => page.locator("iframe.wiki-article");

/** The Raspberry Pi has the Italian and the English edition (WIKI_LANGUAGE=it,en), without touching the mock. */
async function twoEditions(page: Page) {
  await page.route("**/status.json", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.wikipedia.language = "it";
    data.wikipedia.editions = [
      { language: "it", edition: "2026-08", bytes: 31e9 },
      { language: "en", edition: "2026-10", bytes: 52e9 },
    ];
    await route.fulfill({ response, json: data });
  });
}

test.describe("Several Wikipedia editions", () => {
  test("an English browser gets the English one, and can search the other", async ({ page }) => {
    await twoEditions(page);
    await page.goto("/wikipedia/");
    await expect(frameBook(page)).toHaveAttribute("src", /\/wiki\/content\/wikipedia_en\//);
    const picker = page.getByRole("combobox", { name: "Wikipedia edition" });
    await expect(picker).toHaveValue("en");
    await expect(picker.getByRole("option")).toHaveText(["Italiano", "English"]);

    await picker.selectOption("it");
    await expect(frameBook(page)).toHaveAttribute("src", /\/wiki\/content\/wikipedia_it\/$/);
    await expect(page).toHaveURL(/edition=it/);
    const searched = page.waitForRequest((r) => r.url().includes("/wiki/search") && r.url().includes("books.name=wikipedia_it"));
    await field(page).fill("garibaldi");
    await field(page).press("Enter");
    await searched;
    await expect(page).toHaveURL(/#search=garibaldi&edition=it$/);
    await expect(picker).toHaveValue("it");
  });

  test("a bookmark keeps its edition", async ({ page }) => {
    await twoEditions(page);
    await page.goto("/wikipedia/#article=Rome&edition=it");
    await expect(frameBook(page)).toHaveAttribute("src", /\/wiki\/content\/wikipedia_it\/Rome$/);
  });

  test("with one edition there is nothing to choose", async ({ page }) => {
    await page.goto("/wikipedia/");
    await expect(article(page).locator(".mw-parser-output")).toContainText("Welcome");
    await expect(page.getByRole("combobox", { name: "Wikipedia edition" })).toHaveCount(0);
  });

  test.describe("in an Italian browser", () => {
    test.use({ locale: "it-IT" });

    test("gets the Italian one", async ({ page }) => {
      await twoEditions(page);
      await page.goto("/wikipedia/");
      await expect(frameBook(page)).toHaveAttribute("src", /\/wiki\/content\/wikipedia_it\//);
      await expect(page.getByRole("combobox", { name: "Edizione di Wikipedia" })).toHaveValue("it");
    });
  });

  test.describe("in a browser in a language without an edition", () => {
    test.use({ locale: "de-DE" });

    test("gets the first one: the Wikipedia language follows the hub, the map and the addresses do not", async ({ page }) => {
      await twoEditions(page);
      await page.goto("/wikipedia/");
      await expect(frameBook(page)).toHaveAttribute("src", /\/wiki\/content\/wikipedia_it\//);
    });
  });
});

test.describe("Wikipedia", () => {
  test("the hub leads to Wikipedia", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Wikipedia/ }).click();
    await expect(page).toHaveURL(/\/wikipedia\//);
    await expect(article(page).locator(".mw-parser-output")).toContainText("Welcome to Wikipedia");
  });

  test("main page in the style of the hub", async ({ page }) => {
    await page.goto("/wikipedia/");
    await expect(article(page).locator(".mw-parser-output")).toContainText("Welcome to Wikipedia");
    await expect(page).toHaveURL(/#article=Main_Page$/);
    await expect(page).toHaveTitle("Wikipedia, raspberry");
    // on the main page the article title is not needed: the hub header is already there
    await expect(article(page).locator("h1.firstHeading")).toBeHidden();
    // the article is transparent (the frosted panel is underneath) and uses the fonts of the project
    const style = await article(page)
      .locator("body")
      .evaluate((b) => ({ background: getComputedStyle(b).backgroundColor, fonts: getComputedStyle(b).fontFamily }));
    expect(style.background).toBe("rgba(0, 0, 0, 0)");
    expect(style.fonts).toContain("IBM Plex Sans");
  });

  test("suggestions while typing, picked with the keyboard", async ({ page }) => {
    await page.goto("/wikipedia/");
    await field(page).fill("gari");
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("option", { name: "Giuseppe Garibaldi" })).toBeVisible();
    await expect(list.getByRole("option", { name: "Garibaldi (disambiguation)" })).toBeVisible();
    await expect(list.getByRole("option", { name: "Search “gari” in all articles" })).toBeVisible();
    await field(page).press("ArrowDown");
    await field(page).press("Enter");
    await expect(page).toHaveURL(/#article=Giuseppe_Garibaldi$/);
    await expect(article(page).locator("h1")).toHaveText("Giuseppe Garibaldi");
    await expect(page).toHaveTitle("Giuseppe Garibaldi, Wikipedia, raspberry");
  });

  test("full-text search: count, highlighted words, pages", async ({ page }) => {
    await page.goto("/wikipedia/");
    await field(page).fill("garibaldi");
    await field(page).press("Enter");
    await expect(page).toHaveURL(/#search=garibaldi$/);
    await expect(page.locator(".wiki-count")).toHaveText("Results 1-20 of 11,661 for “garibaldi”");
    const results = page.locator(".wiki-results li");
    await expect(results).toHaveCount(20);
    await expect(results.first().locator("mark").first()).toHaveText(/garibaldi/i);
    await expect(results.first().locator(".wiki-words")).toHaveText("1,067 words");

    await page.getByRole("button", { name: "More results" }).click();
    await expect(page).toHaveURL(/#search=garibaldi&from=20$/);
    await expect(page.locator(".wiki-count")).toHaveText("Results 21-40 of 11,661 for “garibaldi”");
    await page.goBack();
    await expect(page.locator(".wiki-count")).toHaveText("Results 1-20 of 11,661 for “garibaldi”");
  });

  test("a search started while the article loads keeps its address", async ({ page }) => {
    // the Raspberry Pi is slow: the main page arrives after a search has already started
    await page.route("**/wiki/content/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto("/wikipedia/");
    await field(page).fill("garibaldi");
    await field(page).press("Enter");
    await expect(page.locator(".wiki-count")).toBeVisible();
    await expect(page.locator("iframe.wiki-article")).toBeAttached();
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(/#search=garibaldi$/);
    await expect(page.locator(".wiki-count")).toBeVisible();
  });

  test("Esc closes the suggestions but keeps the text", async ({ page }) => {
    await page.goto("/wikipedia/");
    await field(page).fill("gari");
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeVisible();
    await field(page).press("Escape");
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeHidden();
    await expect(field(page)).toHaveValue("gari");
  });

  test("search without results", async ({ page }) => {
    await page.goto("/wikipedia/");
    await field(page).fill("zzzqqq");
    await field(page).press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "No article contains “zzzqqq”" })).toBeVisible();
  });

  test("from a result to the article, then an internal link", async ({ page }) => {
    await page.goto("/wikipedia/#search=garibaldi");
    await page.getByRole("button", { name: "Giuseppe Garibaldi", exact: true }).click();
    await expect(page).toHaveURL(/#article=Giuseppe_Garibaldi$/);
    await expect(article(page).locator("h1")).toHaveText("Giuseppe Garibaldi");

    await article(page).getByRole("link", { name: "Nice" }).click();
    await expect(page).toHaveURL(/#article=Nice$/);
    await expect(article(page).locator("h1")).toHaveText("Nice");
    await expect(page).toHaveTitle("Nice, Wikipedia, raspberry");
    await expect(page.locator(".wiki-sheet")).toHaveAttribute("aria-busy", "false");

    await page.goBack();
    await expect(article(page).locator("h1")).toHaveText("Giuseppe Garibaldi");
  });

  test("the article takes the height of its content: the page scrolls, not a box", async ({ page }) => {
    await page.goto("/wikipedia/#article=Rome");
    await expect(article(page).locator("h1")).toHaveText("Rome");
    await expect
      .poll(() =>
        page.locator("iframe.wiki-article").evaluate((f: HTMLIFrameElement) => {
          const inner = f.contentDocument?.documentElement.scrollHeight ?? 0;
          return Math.abs(f.offsetHeight - inner) <= 2 && inner > window.innerHeight;
        }),
      )
      .toBe(true);
    const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 200);
    expect(scrolls).toBe(true);
  });

  test("random article", async ({ page }) => {
    await page.goto("/wikipedia/");
    await expect(article(page).locator(".mw-parser-output")).toContainText("Welcome");
    await page.getByRole("button", { name: "Random article" }).click();
    await expect(page).toHaveURL(/#article=Rome$/);
    await expect(article(page).locator("h1")).toHaveText("Rome");
  });

  test("bookmarks from version 1.x still open the article", async ({ page }) => {
    await page.goto("/wikipedia/#voce=Galileo_Galilei");
    await expect(article(page).locator("h1")).toHaveText("Galileo Galilei");
    await expect(page).toHaveURL(/#article=Galileo_Galilei$/);
  });

  test.describe("with the dark browser theme", () => {
    test.use({ colorScheme: "dark" });

    test("the article follows the hub theme, also when it changes", async ({ page }) => {
      await page.goto("/wikipedia/#article=Galileo_Galilei");
      await expect(article(page).locator("h1")).toHaveText("Galileo Galilei");
      await expect(article(page).locator("html")).toHaveClass(/skin-theme-clientpref-night/);
      await expect(article(page).locator("body")).toHaveCSS("color", "rgb(243, 245, 241)");

      await page.getByRole("button", { name: "Theme: light" }).click();
      await expect(article(page).locator("html")).toHaveClass(/skin-theme-clientpref-day/);
      await expect(article(page).locator("body")).toHaveCSS("color", "rgb(22, 32, 26)");
    });
  });

  test("opens the edition the Raspberry Pi has downloaded, whatever its language", async ({ page }) => {
    await page.route("**/status.json", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.wikipedia.language = "en";
      data.wikipedia.editions = [{ language: "en", edition: "2026-10", bytes: 52e9 }];
      await route.fulfill({ response, json: data });
    });
    await page.goto("/wikipedia/");
    await expect(article(page).locator(".mw-parser-output")).toContainText("Welcome to Wikipedia");
    await expect(page.locator("iframe.wiki-article")).toHaveAttribute("src", /\/wiki\/content\/wikipedia_en\//);
    const searched = page.waitForRequest((r) => r.url().includes("/wiki/search") && r.url().includes("books.name=wikipedia_en"));
    await field(page).fill("garibaldi");
    await field(page).press("Enter");
    await searched;
    await expect(page.locator(".wiki-count")).toHaveText("Results 1-20 of 11,661 for “garibaldi”");
  });

  test("a Raspberry Pi with older scripts has the Italian edition", async ({ page }) => {
    await page.route("**/status.json", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      delete data.wikipedia.language;
      delete data.wikipedia.editions;
      await route.fulfill({ response, json: data });
    });
    await page.goto("/wikipedia/");
    await expect(page.locator("iframe.wiki-article")).toHaveAttribute("src", /\/wiki\/content\/wikipedia_it\//);
  });

  test("Wikipedia switched off: explains what to do and leads back to the hub", async ({ page }) => {
    await serviceIn(page, "wikipedia", "off");
    await page.goto("/wikipedia/");
    await expect(page.getByRole("heading", { name: "Wikipedia is switched off" })).toBeVisible();
    await expect(page.locator("iframe.wiki-article")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Random article" })).toBeDisabled();
    await page.getByRole("link", { name: "Back to the hub" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
