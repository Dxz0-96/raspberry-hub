import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

/** Changes the hardware readings of the mock Raspberry Pi for this page only. */
async function readings(page: Page, change: (data: Record<string, unknown>) => void) {
  await page.route("**/control/system", async (route) => {
    try {
      const response = await route.fetch();
      const data = await response.json();
      change(data);
      await route.fulfill({ response, json: data });
    } catch {
      // the page is closing (end of the test) while a 5 s poll was on its way
      await route.abort().catch(() => {});
    }
  });
}

test.describe("Looking after the Raspberry Pi", () => {
  test("under-voltage and throttling episodes in each period", async ({ page }) => {
    await page.goto("/");
    const trends = page.getByRole("region", { name: "Trends" });
    // the mock had one of each five hours ago
    await expect(trends.getByText("No under-voltage or throttling in this period.")).toBeVisible();
    await trends.getByRole("button", { name: "24 hours" }).click();
    await expect(trends.getByText("Under-voltage: once. Throttling: once.")).toBeVisible();
    await expect(trends.getByText("use the official 2.5 A power supply", { exact: false })).toBeVisible();
    await trends.getByRole("button", { name: "Last month" }).click();
    await expect(trends.getByText(/^Under-voltage: \d+ times\. Throttling: \d+ times\.$/)).toBeVisible();
  });

  test("a check that failed after the last start is an alert", async ({ page }) => {
    await readings(page, (data) => {
      data.alerts = ["check_failed"];
      data.check = { time: "2026-11-20T08:00:00+0100", failed: 2, failures: ["caddy running", "hub home page"] };
    });
    await page.goto("/");
    await expect(page.getByText("After the last start, 2 checks of the hub failed: run sudo hub-check.sh on the Raspberry Pi to see which."))
      .toBeVisible();
  });

  test("the content on a USB disk", async ({ page }) => {
    await readings(page, (data) => {
      Object.assign(data.disk as object, { device: "sda1", medium: "usb" });
    });
    await page.goto("/");
    await expect(page.getByRole("img", { name: /^Space on the USB disk: System / })).toBeVisible();
    await expect(page.getByText("sda1")).toBeVisible();
  });

  test("on the microSD, as most Raspberry Pis are", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("img", { name: /^Space on the microSD: System / })).toBeVisible();
  });
});

test.describe("Looking after the Raspberry Pi, in Italian", () => {
  test.use({ locale: "it-IT" });

  test("the disk and the power supply", async ({ page }) => {
    await readings(page, (data) => {
      Object.assign(data.disk as object, { device: "sda1", medium: "usb" });
    });
    await page.goto("/");
    await expect(page.getByRole("img", { name: /^Spazio sul disco USB: Sistema / })).toBeVisible();
    const trends = page.getByRole("region", { name: "Andamento" });
    await trends.getByRole("button", { name: "24 ore" }).click();
    await expect(trends.getByText("Sottotensione: una volta. Rallentamento: una volta.")).toBeVisible();
  });
});
