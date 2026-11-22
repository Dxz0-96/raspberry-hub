import { expect, test } from "../tests/helpers";

// The demo for GitHub Pages: the same hub, with lib/demo.ts answering instead of a Raspberry Pi.
test.describe("Demo", () => {
  test("says it is a demo, with the login to try it", async ({ page }) => {
    await page.goto("");
    const banner = page.getByRole("complementary", { name: "Demo" });
    await expect(banner).toContainText("log in as admin with the password demo");
    await expect(banner.getByRole("link", { name: "How to install it" }))
      .toHaveAttribute("href", "https://github.com/Dxz0-96/raspberry-hub#installation");
    const services = page.getByRole("region", { name: "Services" });
    await expect(services.getByRole("link", { name: /^Maps/ })).toBeVisible();
    await expect(services.getByRole("link", { name: /^NAS, 192\.168\.1\.20 is not responding/ })).toBeVisible();
    // the icons are files next to the demo (decorative, so found by tag): under /raspberry-hub/ they load too
    await expect.poll(() => services.locator("img").first().evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByRole("link", { name: "Home certificate" })).toHaveCount(0);
  });

  test("the switches work in memory, until the page reloads", async ({ page }) => {
    await page.goto("");
    const maps = page.getByRole("switch", { name: "Maps" });
    await expect(maps).toHaveAttribute("aria-checked", "true");
    await maps.click();
    const dialog = page.getByRole("dialog", { name: "Log in to the hub" });
    await dialog.getByLabel("Password").fill("demo");
    await dialog.getByRole("button", { name: "Log in" }).click();
    await expect(maps).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(page.getByRole("switch", { name: "Maps" })).toHaveAttribute("aria-checked", "true");
  });

  test("the hardware, with the last month", async ({ page }) => {
    await page.goto("hardware/");
    const trends = page.getByRole("region", { name: "Trends" });
    await trends.getByRole("button", { name: "Last month" }).click();
    const cpu = trends.getByRole("slider", { name: "Processor" });
    await cpu.focus();
    await cpu.press("Home");
    await expect(cpu).toHaveAttribute("aria-valuetext", /average \d+%, peak \d+%$/);
  });

  test("the map of Rome and the address search", async ({ page }) => {
    // the map draws in a worker (a module, .mjs): if it cannot load, the map stays an empty grey box. The fonts and
    // icons (npm run assets) are downloaded by demo.yml, not by CI: their 404s here do not count.
    const problems: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error" && !text.includes("/map-assets/") && !text.includes("404 (Not Found)")) problems.push(text);
    });
    page.on("pageerror", (error) => problems.push(error.message));
    await page.goto("maps/");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await page.getByRole("combobox", { name: "Search for an address or a place" }).fill("roma");
    await expect(page.getByRole("listbox", { name: "Results" }).getByRole("option").first()).toContainText("Roma");
    await page.waitForTimeout(1000);
    expect(problems).toEqual([]);
  });

  test("Wikipedia is switched off, and has nothing to download", async ({ page }) => {
    await page.goto("wikipedia/");
    await expect(page.getByRole("heading", { name: "Wikipedia is switched off" })).toBeVisible();
    // the demo has no Wikipedia: it takes no space, and switched on it says so (no edition installed)
    await page.goto("");
    await expect(page.getByRole("img", { name: /^Space on the microSD:/ })).toHaveAttribute("aria-label", /Wikipedia 0 MB,/);
    await page.getByRole("switch", { name: "Wikipedia" }).click();
    const dialog = page.getByRole("dialog", { name: "Log in to the hub" });
    await dialog.getByLabel("Password").fill("demo");
    await dialog.getByRole("button", { name: "Log in" }).click();
    const services = page.getByRole("region", { name: "Services" });
    await expect(services.getByRole("link", { name: /^Wikipedia/ })).toContainText("Content not downloaded yet");
  });
});
