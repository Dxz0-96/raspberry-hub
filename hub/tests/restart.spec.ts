import { expect, test } from "./helpers";

// The restart button of the header. The restart itself is answered here with page.route: the shared mock Raspberry Pi
// must not restart under the other tests.

test.describe("Restart", () => {
  test("asks for the login and a confirmation, then waits for the Raspberry Pi to come back", async ({ page }) => {
    let restarted = false;
    await page.route("**/control/reboot", async (route) => {
      expect(route.request().headers()["x-hub"]).toBe("1");
      restarted = true;
      await route.fulfill({ status: 202, json: { ok: true } });
    });
    // after the restart: first no answer, then a Raspberry Pi that has just started
    let calls = 0;
    await page.route("**/control/system", async (route) => {
      if (restarted && ++calls === 1) return route.abort();
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: restarted ? { ...data, uptime: 40 } : data });
    });

    await page.goto("/");
    const button = page.getByRole("banner").getByRole("button", { name: "Restart the Raspberry Pi" });
    await button.click();
    // not logged in: the login comes first
    const login = page.getByRole("dialog", { name: "Log in to the hub" });
    await login.getByLabel("Password").fill("test1234");
    await login.getByRole("button", { name: "Log in" }).click();

    const dialog = page.getByRole("dialog", { name: "Restart the Raspberry Pi" });
    await expect(dialog.getByText("as with sudo reboot", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(restarted).toBe(false);

    // logged in now: straight to the confirmation
    await button.click();
    await dialog.getByRole("button", { name: "Restart", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("is restarting");
    expect(restarted).toBe(true);
    await expect(dialog.getByRole("status")).toContainText("has restarted", { timeout: 20_000 });
  });

  test("says when a download is running, and that it goes on later", async ({ page }) => {
    await page.route("**/status.json", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.addresses.running = true;
      await route.fulfill({ response, json: data });
    });
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: "Restart the Raspberry Pi" }).click();
    const login = page.getByRole("dialog", { name: "Log in to the hub" });
    await login.getByLabel("Password").fill("test1234");
    await login.getByRole("button", { name: "Log in" }).click();
    const dialog = page.getByRole("dialog", { name: "Restart the Raspberry Pi" });
    await expect(dialog.getByText("the restart stops it", { exact: false })).toBeVisible();
  });
});
