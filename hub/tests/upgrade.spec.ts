import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

// The mock Raspberry Pi reports no newer release: these tests make one appear with page.route, and answer
// the upgrade themselves, so the shared mock never changes.

/** The installed version, and the next minor and major ones. */
async function versions(page: Page) {
  const installed = (await (await page.request.get("/control/status")).json()).version as string;
  const [major, minor] = installed.split(".").map(Number);
  return { installed, minor: `${major}.${minor + 1}.0`, major: `${major + 1}.0.0` };
}

/** The daily check found this release (it is in status.json). */
async function releaseFound(page: Page, version: string) {
  await page.route("**/status.json", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), latest: { version, url: `https://github.com/Dxz0-96/raspberry-hub/releases/tag/v${version}` } },
    });
  });
}

/** GET and POST /control/upgrade answered here: the steps go on when the test says so. */
async function upgradeOnThePi(page: Page, installed: string, version: string) {
  const pi = { installed, step: null as string | null, error: null as string | null };
  const progress = () =>
    pi.step && { version, from: installed, step: pi.step, result: pi.step === "done" ? "ok" : null, error: pi.error,
      warning: null, started: "2026-11-20T15:00:00+0100", updated: null };
  await page.route("**/control/upgrade", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ version });
      pi.step = "start";
      return route.fulfill({ status: 202, json: { ok: true } });
    }
    await route.fulfill({
      json: { installed: pi.installed, newer: true, progress: progress(),
        latest: { version, url: "https://example.invalid", notes: "### Features\n\n* **hub:** a new view ([#34](https://x/34)) ([abc1234](https://x/abc))" } },
    });
  });
  // after the installation the Raspberry Pi answers with the new version
  await page.route("**/control/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), version: pi.installed } });
  });
  return pi;
}

async function logIn(page: Page) {
  const login = page.getByRole("dialog", { name: "Log in to the hub" });
  await login.getByLabel("Password").fill("test1234");
  await login.getByRole("button", { name: "Log in" }).click();
  await expect(login).toBeHidden();
}

test.describe("New version", () => {
  test("no notice while the installed version is the latest", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("contentinfo").getByRole("button", { name: "Update" })).toHaveCount(0);
  });

  test("the footer says when a newer release is out", async ({ page }) => {
    const { minor } = await versions(page);
    await releaseFound(page, minor);
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText(`Version ${minor} is available.`)).toBeVisible();
    await expect(footer.getByRole("link", { name: /^What's new/ }))
      .toHaveAttribute("href", `https://github.com/Dxz0-96/raspberry-hub/releases/tag/v${minor}`);
    await expect(footer.getByRole("link", { name: /^Read before updating/ })).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Update" })).toBeVisible();
  });

  test("a new major version points to what changes", async ({ page }) => {
    const { major } = await versions(page);
    await releaseFound(page, major);
    await upgradeOnThePi(page, (await versions(page)).installed, major);
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: /^Read before updating/ }))
      .toHaveAttribute("href", "https://github.com/Dxz0-96/raspberry-hub/blob/main/docs/upgrading.md");
    await footer.getByRole("button", { name: "Update" }).click();
    await logIn(page);
    const dialog = page.getByRole("dialog", { name: `Update to ${major}` });
    await expect(dialog.getByText(`${major} is a new major version`)).toBeVisible();
  });

  test("the update runs from the hub, then the new website loads", async ({ page }) => {
    const { installed, minor } = await versions(page);
    await releaseFound(page, minor);
    const pi = await upgradeOnThePi(page, installed, minor);
    await page.clock.install();
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("button", { name: "Update" }).click();
    await logIn(page);

    const dialog = page.getByRole("dialog", { name: `Update to ${minor}` });
    await expect(dialog.getByText(`Installed: ${installed}. New version: ${minor}.`)).toBeVisible();
    // the release notes, without the links to pull requests and commits
    await expect(dialog.getByRole("listitem").filter({ hasText: "hub: a new view" })).toHaveText("hub: a new view");
    await dialog.getByRole("button", { name: "Update" }).click();

    const steps = dialog.getByRole("list", { name: "Progress of the update" });
    await expect(steps.getByRole("listitem")).toHaveText(["Download", "Check the package", "Install", "Check after the restart"]);
    pi.step = "install";
    await page.clock.runFor(5000);
    await expect(steps.locator('[aria-current="step"]')).toHaveText("Install");
    await expect(steps.getByRole("listitem").first()).toHaveText("Download: done");

    pi.step = "done";
    pi.installed = minor;
    const reloaded = page.waitForEvent("load");
    await page.clock.runFor(5000);
    await expect(dialog.getByText(`Version ${minor} is installed. The page reloads by itself.`)).toBeVisible();
    await page.clock.runFor(5000);
    await reloaded;
    await expect(page.getByRole("contentinfo").getByText(`Version ${minor} is available.`)).toHaveCount(0);
  });

  test("a failed update says why", async ({ page }) => {
    const { installed, minor } = await versions(page);
    await releaseFound(page, minor);
    const pi = await upgradeOnThePi(page, installed, minor);
    await page.clock.install();
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("button", { name: "Update" }).click();
    await logIn(page);
    const dialog = page.getByRole("dialog", { name: `Update to ${minor}` });
    await dialog.getByRole("button", { name: "Update" }).click();
    pi.step = "verify";
    await page.clock.runFor(5000);
    const steps = dialog.getByRole("list", { name: "Progress of the update" });
    await expect(steps.locator('[aria-current="step"]')).toHaveText("Check the package");
    pi.step = "failed";
    pi.error = "checksum_mismatch";
    await page.clock.runFor(5000);
    await expect(dialog.getByRole("alert"))
      .toContainText("The package does not match its published checksum, so it was not installed.");
    await expect(steps.getByRole("listitem").first()).toHaveText("Download: done");
    await expect(steps.locator('[aria-current="step"]')).toHaveText("Check the package");
  });
});
