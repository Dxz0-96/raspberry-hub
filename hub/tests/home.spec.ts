import { expect, serviceIn, test } from "./helpers";

test.describe("Home", () => {
  test("lists the services with their state", async ({ page }) => {
    await page.goto("/");
    const services = page.getByRole("region", { name: "Services" });
    await expect(services.getByRole("link", { name: /^Pi-hole, Blocking active/ })).toBeVisible();
    await expect(services.getByRole("link", { name: /^Maps, Updated on November 16/ })).toBeVisible();
    await expect(services.getByRole("link", { name: /^NAS, 192\.168\.1\.20 is not responding/ })).toBeVisible();
    await expect(page.getByText("Last 24 hours: 27,844 queries, 13,559 blocked.", { exact: false })).toBeVisible();
  });

  test("a switch asks to log in, then sends the command", async ({ page }) => {
    // the switch itself is answered here: the mock Raspberry Pi is shared by the tests running in parallel
    await page.route("**/control/services/maps/switch", async (route) => {
      const status = await (await page.request.get("/control/status")).json();
      status.services.maps = { ...status.services.maps, state: "off" };
      await serviceIn(page, "maps", "off");      // the next status polls agree
      await route.fulfill({ json: { ok: true, services: status.services } });
    });
    await page.goto("/");
    const maps = page.getByRole("switch", { name: "Maps" });
    await expect(maps).toHaveAttribute("aria-checked", "true");
    await maps.click();
    const dialog = page.getByRole("dialog", { name: "Log in to the hub" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Password").fill("wrong-password");
    await dialog.getByRole("button", { name: "Log in" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/^Wrong username or password\. You have \d attempts? left\.$/);
    await dialog.getByLabel("Password").fill("test1234");
    const command = page.waitForRequest("**/control/services/maps/switch");
    await dialog.getByRole("button", { name: "Log in" }).click();
    await expect(dialog).toBeHidden();
    expect((await command).postDataJSON()).toEqual({ on: false });
    await expect(maps).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: "admin" })).toBeVisible();
  });

  test("the page Caddy shows for a service that is off", async ({ page }) => {
    await page.goto("/unavailable/");
    await expect(page.getByRole("heading", { name: "This service is off or not responding" })).toBeVisible();
    await expect(page).toHaveTitle("Service unavailable, raspberry");
  });

  test("unknown address", async ({ page }) => {
    await page.goto("/does-not-exist/");
    await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
  });
});
