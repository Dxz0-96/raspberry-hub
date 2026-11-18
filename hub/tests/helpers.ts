import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

/** Playwright's test, with page.goto() waiting until React has taken over the page: lib/i18n.tsx marks it
 *  with data-i18n="ready". Typing into the static HTML before that would be lost. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await goto(url, options);
      await page.locator('html[data-i18n="ready"]').waitFor({ state: "attached" });
      return response;
    };
    await use(page);
  },
});

/** Makes the hub believe a service is in a given state (off, missing...), without touching the mock Raspberry Pi. */
export async function serviceIn(page: Page, id: string, state: string) {
  await page.route("**/control/status", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.services[id] = { ...data.services[id], state };
    await route.fulfill({ response, json: data });
  });
}

/** The map position written in the address: #position=zoom/lat/lon */
export function position(url: string): { zoom: number; lat: number; lon: number } | null {
  const found = /position=([\d.]+)\/([\d.-]+)\/([\d.-]+)/.exec(decodeURIComponent(new URL(url).hash));
  return found ? { zoom: Number(found[1]), lat: Number(found[2]), lon: Number(found[3]) } : null;
}
