import { expect, test } from "./helpers";

test.describe("Trends", () => {
  test("a chart can be read from the keyboard", async ({ page }) => {
    await page.goto("/");
    const trends = page.getByRole("region", { name: "Trends" });
    const cpu = trends.getByRole("slider", { name: "Processor" });
    const caption = trends.getByRole("figure").filter({ has: page.getByRole("slider", { name: "Processor" }) })
      .locator(".chart-value");
    await expect(cpu).toBeVisible();
    const last = await cpu.getAttribute("aria-valuemax");
    const now = await caption.textContent();

    await cpu.focus();
    await cpu.press("Home");
    await expect(cpu).toHaveAttribute("aria-valuenow", "0");
    await expect(cpu).toHaveAttribute("aria-valuetext", /^\d+% at \d{2}:\d{2}$/);
    // what a screen reader hears is what the caption shows
    await expect(caption).toHaveText((await cpu.getAttribute("aria-valuetext"))!);

    await cpu.press("ArrowRight");
    await expect(cpu).toHaveAttribute("aria-valuenow", "1");
    await cpu.press("End");
    await expect(cpu).toHaveAttribute("aria-valuenow", last!);
    await cpu.press("Escape");
    await expect(caption).not.toHaveText(/ at /);
    expect(now).not.toMatch(/ at /);
  });

  test("the last month, one point per hour with its peak, read only while shown", async ({ page }) => {
    const months: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/control/system/history?period=month")) months.push(request.url());
    });
    await page.goto("/");
    const trends = page.getByRole("region", { name: "Trends" });
    await expect(trends.getByRole("slider", { name: "Processor" })).toBeVisible();
    expect(months).toHaveLength(0);

    const read = page.waitForRequest("**/control/system/history?period=month");
    await trends.getByRole("button", { name: "Last month" }).click();
    await read;
    await expect(trends.getByRole("button", { name: "Last month" })).toHaveAttribute("aria-pressed", "true");
    await expect(trends.getByRole("button", { name: "Last hour" })).toHaveAttribute("aria-pressed", "false");
    // the time axis and the summary carry the date as well as the time
    await expect(trends.getByRole("img", { name: /^Processor: now \d+%\. Between \w{3} \d{1,2}, \d{2}:00 and \w{3} \d{1,2}, \d{2}:00/ }))
      .toBeVisible();

    const cpu = trends.getByRole("slider", { name: "Processor" });
    await cpu.focus();
    await cpu.press("Home");
    await expect(cpu).toHaveAttribute("aria-valuetext", /^\w{3} \d{1,2}, \d{2}:00: average \d+%, peak \d+%$/);
    const temperature = trends.getByRole("slider", { name: "Temperature" });
    await temperature.focus();
    await temperature.press("End");
    await expect(temperature).toHaveAttribute("aria-valuetext", /: average \d+ °C, peak \d+ °C$/);
    await expect(trends.getByText("One point per hour: the line is the average, the band reaches the peak.")).toBeVisible();
  });

  test("no table repeats the charts", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Trends" }).getByRole("table")).toHaveCount(0);
  });
});

test.describe("Trends in Italian", () => {
  test.use({ locale: "it-IT" });

  test("the month with Italian dates", async ({ page }) => {
    await page.goto("/");
    const trends = page.getByRole("region", { name: "Andamento" });
    await trends.getByRole("button", { name: "Ultimo mese" }).click();
    const cpu = trends.getByRole("slider", { name: "Processore" });
    await cpu.focus();
    await cpu.press("End");
    await expect(cpu).toHaveAttribute("aria-valuetext", /^\d{1,2} \w{3}, \d{2}:00: media \d+%, picco \d+%$/);
  });
});
