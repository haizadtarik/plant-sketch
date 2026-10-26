import { test, expect } from "@playwright/test";

test("starts a computer-use run, shows evidence, and cancels through the worker", async ({
  page,
}) => {
  let cancelled = false,
    started = false;
  await page.route("**/api/fuxa-agent/**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe("Bearer local-test-token");
    if (request.method() === "POST") {
      expect(request.postDataJSON().plant.items).toHaveLength(7);
      started = true;
    }
    if (request.method() === "DELETE") cancelled = true;
    await route.fulfill({
      json: {
        id: "demo-run",
        status: cancelled ? "cancelled" : "running",
        phase: "Import project",
        message: cancelled
          ? "Pump stopped; run cancelled."
          : "Opening FUXA editor",
        startedAt: new Date().toISOString(),
        checks: [{ name: "Project bindings verified" }],
        events: [],
        screenshot:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try sample P&ID" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Worker access token").fill("local-test-token");
  await page.getByRole("button", { name: "Set up and test in FUXA" }).click();
  await expect(page.getByText("Opening FUXA editor")).toBeVisible();
  await expect(
    page.getByAltText("Latest FUXA computer-use screenshot"),
  ).toBeVisible();
  await expect(page.getByText("Project bindings verified")).toBeVisible();
  expect(started).toBe(true);
  await page.getByRole("button", { name: "Stop agent" }).click();
  await expect(page.getByText("Pump stopped; run cancelled.")).toBeVisible();
  expect(cancelled).toBe(true);
});

test("reports an unavailable worker without claiming success", async ({
  page,
}) => {
  await page.route("**/api/fuxa-agent/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Computer-use worker is not configured." },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Try sample P&ID" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Worker access token").fill("local-test-token");
  await page.getByRole("button", { name: "Set up and test in FUXA" }).click();
  await expect(
    page.getByText("Computer-use worker is not configured.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up and test in FUXA" }),
  ).toBeEnabled();
});
