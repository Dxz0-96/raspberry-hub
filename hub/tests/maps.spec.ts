import { expect, position, serviceIn, test } from "./helpers";

const field = "Search for an address or a place";

test.describe("Maps", () => {
  test("the hub leads to the map", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Maps/ }).click();
    await expect(page).toHaveURL(/\/maps\/$/);
    await expect(page.getByRole("combobox", { name: field })).toBeVisible();
  });

  test("the map draws with the offline data of the Raspberry Pi", async ({ page }) => {
    const tiles = page.waitForResponse((r) => r.url().includes("/tiles/basemap.pmtiles") && r.status() === 206);
    await page.goto("/maps/");
    await tiles;
    const canvas = page.locator(".maplibregl-canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(300);
    expect(box?.height).toBeGreaterThan(300);
    // the address remembers the position: it starts from the whole of Italy
    await expect.poll(() => position(page.url())?.zoom ?? 99).toBeLessThan(7);
    await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");
  });

  test("searches a place and moves the map there, with the marker", async ({ page }) => {
    await page.goto("/maps/");
    const search = page.getByRole("combobox", { name: field });
    await search.fill("roma lazio");
    const list = page.getByRole("listbox", { name: "Results" });
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option").first()).toContainText("Roma");
    await expect(list.getByRole("option").first()).toContainText("City, Roma, Lazio");
    await search.press("Enter");
    await expect(list).toBeHidden();
    await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
    await expect
      .poll(() => {
        const here = position(page.url());
        return Boolean(here && Math.abs(here.lat - 41.89) < 0.2 && Math.abs(here.lon - 12.48) < 0.3 && here.zoom > 8);
      })
      .toBe(true);
  });

  test("the keyboard picks the second result, a house number", async ({ page }) => {
    await page.goto("/maps/");
    const search = page.getByRole("combobox", { name: field });
    await search.fill("garibaldi milano");
    const options = page.getByRole("listbox", { name: "Results" }).getByRole("option");
    await expect(options).toHaveCount(2);
    await search.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(search).toHaveAttribute("aria-activedescendant", (await options.nth(1).getAttribute("id")) ?? "");
    await search.press("Enter");
    await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
    await expect.poll(() => position(page.url())?.zoom ?? 0).toBeGreaterThan(16);
    await expect.poll(() => position(page.url())?.lat.toFixed(2)).toBe("45.47");
  });

  test("a search without results says what to try", async ({ page }) => {
    await page.goto("/maps/");
    await page.getByRole("combobox", { name: field }).fill("via inesistente xyz");
    await expect(page.getByRole("status").filter({ hasText: "No results" })).toBeVisible();
  });

  test("Esc closes the results, the x clears the field", async ({ page }) => {
    await page.goto("/maps/");
    const search = page.getByRole("combobox", { name: field });
    await search.fill("milano");
    await expect(page.getByRole("listbox", { name: "Results" })).toBeVisible();
    await search.press("Escape");
    await expect(page.getByRole("listbox", { name: "Results" })).toBeHidden();
    await expect(search).toHaveValue("milano");
    await page.getByRole("button", { name: "Clear the search" }).click();
    await expect(search).toHaveValue("");
  });

  test("bookmarks from version 1.x keep their position", async ({ page }) => {
    await page.goto("/maps/#posizione=12/45.4642/9.19");
    await expect.poll(() => position(page.url())?.zoom ?? 0).toBe(12);
    await expect.poll(() => position(page.url())?.lat.toFixed(2)).toBe("45.46");
  });

  test("maps switched off: says so and does not draw the map", async ({ page }) => {
    await page.route("**/tiles/basemap.pmtiles", (route) => route.fulfill({ status: 503, body: "Maps switched off from the hub" }));
    await page.goto("/maps/");
    await expect(page.getByRole("heading", { name: "The maps are switched off" })).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  });

  test("a browser without WebGL 2 says so instead of waiting forever", async ({ page }) => {
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
        return type === "webgl2" ? null : getContext.call(this, type, options);
      } as typeof getContext;
    });
    await page.goto("/maps/");
    await expect(page.getByRole("heading", { name: "This browser cannot draw the map" })).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  });

  test("maps not downloaded yet", async ({ page }) => {
    await page.route("**/tiles/basemap.pmtiles", (route) => route.fulfill({ status: 404 }));
    await serviceIn(page, "maps", "missing");
    await page.goto("/maps/");
    await expect(page.getByRole("heading", { name: "The maps have not been downloaded yet" })).toBeVisible();
  });
});
