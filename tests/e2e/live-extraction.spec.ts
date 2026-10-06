import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { PlantSchema } from "../../lib/model";

// Explicit opt-in: these call the configured provider and incur API usage.
for (const fixture of ["clear", "alternate", "ambiguous"]) {
  test(`live ${fixture} upload → direct HMI → FUXA project`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.PNID_LIVE_EXTRACTION !== "1",
      "Requires explicitly enabled live API test",
    );
    test.setTimeout(150_000);
    await page.goto("/");
    await page
      .locator(
        'input[type=file][accept="application/pdf,image/png,image/jpeg"]',
      )
      .setInputFiles(
        `public/fixtures/${fixture}.${fixture === "alternate" ? "pdf" : "png"}`,
      );
    await expect(
      page.getByRole("button", { name: "Create HMI" }),
    ).toBeEnabled();
    const pending = page.waitForResponse("**/api/extract", {
      timeout: 110_000,
    });
    await page.getByRole("button", { name: "Create HMI" }).click();
    const response = await pending;
    const body = await response.json();
    writeFileSync(
      testInfo.outputPath("extraction.json"),
      JSON.stringify(body, null, 2),
    );
    expect(response.status(), JSON.stringify(body)).toBe(200);
    const model = PlantSchema.parse(body.model);
    expect(model.source.mode).toBe("ai");
    await expect(
      page.getByRole("heading", { name: "Overview generated" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review", exact: true }),
    ).toHaveCount(0);
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download FUXA project" }).click();
    const download = await pendingDownload;
    const project = JSON.parse(readFileSync((await download.path())!, "utf8"));
    for (const item of model.items) {
      expect(project.hmi.views[0].items[`shape_${item.id}`].lock).toBe(false);
    }
    await page.screenshot({
      path: testInfo.outputPath("hmi.png"),
      fullPage: true,
    });
  });
}
