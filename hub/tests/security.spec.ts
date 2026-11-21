import { expect, test } from "./helpers";

// The headers of pi/Caddyfile, which the mock Raspberry Pi sends too (read from the Caddyfile itself).

test.describe("Security headers", () => {
  test("the pages of the hub cannot be framed by another site and load nothing from elsewhere", async ({ request }) => {
    for (const path of ["/", "/maps/", "/wikipedia/", "/does-not-exist/"]) {
      const response = await request.get(path);
      const headers = response.headers();
      expect(headers["x-frame-options"], path).toBe("SAMEORIGIN");
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'self'");
      expect(headers["content-security-policy"], path).toContain("connect-src 'self'");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
    }
    // Wikipedia is shown by the hub in a frame of its own
    const article = await request.get("/wiki/content/wikipedia_it/Main_Page");
    expect(article.headers()["x-frame-options"]).toBeUndefined();
  });

  test("a page of another site shows nothing of the hub in a frame", async ({ page, baseURL }) => {
    // about:blank with a frame: its origin is not the one of the hub
    const loaded = page.waitForEvent("framenavigated", (frame) => frame !== page.mainFrame());
    await page.setContent(`<iframe src="${baseURL}/" title="hub"></iframe>`);
    const frame = await loaded;
    // the browser shows its own error page in the frame instead of the hub
    await expect.poll(() => frame.url()).toMatch(/^chrome-error:/);
    await expect(page.frameLocator('iframe[title="hub"]').getByRole("button", { name: "Add service" })).toHaveCount(0);
  });

  test("using the hub breaks none of its rules", async ({ page }) => {
    const violations: string[] = [];
    await page.exposeFunction("reportViolation", (text: string) => violations.push(text));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as unknown as { reportViolation: (text: string) => void })
          .reportViolation(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Add service" })).toBeVisible();
    await page.goto("/hardware/");
    await page.waitForTimeout(500);
    const tiles = page.waitForResponse((r) => r.url().includes("/tiles/basemap.pmtiles") && r.status() === 206);
    await page.goto("/maps/");
    await tiles;
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await page.getByRole("combobox", { name: "Search for an address or a place" }).fill("roma lazio");
    await expect(page.getByRole("listbox", { name: "Results" }).getByRole("option")).toHaveCount(1);
    await page.goto("/wikipedia/#article=Rome");
    await expect(page.frameLocator("iframe.wiki-article").locator("h1")).toHaveText("Rome");
    await page.waitForTimeout(500);
    expect(violations).toEqual([]);
  });
});
