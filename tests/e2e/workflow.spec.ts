import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { initialState, step } from "../../lib/simulation.mjs";
test("sample direct HMI → generation → simulation → export and invalidation", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.goto("/");
  await page.screenshot({ path: testInfo.outputPath("upload.png") });
  await page.getByRole("button", { name: "Try sample P&ID" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview generated" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open simulation" }).click();
  await page.getByRole("button", { name: "Start pump", exact: true }).click();
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await expect(page.getByTestId("flow-value")).toContainText("10.0");
  await page.screenshot({ path: testInfo.outputPath("simulation.png") });
  const overlaps = await page.locator(".process-svg").evaluate((svg) => {
    const groups = Array.from(svg.querySelectorAll(":scope > g"));
    const collisions: string[] = [];
    for (const [index, group] of groups.entries()) {
      for (const text of group.querySelectorAll(":scope > text")) {
        const label = text.getBoundingClientRect();
        for (const [other, target] of groups.entries()) {
          if (index === other) continue;
          const shape = target
            .querySelector(":scope > g")!
            .getBoundingClientRect();
          if (
            label.left < shape.right &&
            label.right > shape.left &&
            label.top < shape.bottom &&
            label.bottom > shape.top
          ) {
            collisions.push(text.textContent || "label");
          }
        }
      }
    }
    return collisions;
  });
  expect(overlaps).toEqual([]);

  await expect(page.getByTestId("source-level")).not.toContainText("80.0");
  await page.getByLabel("Inject simulated pump fault").check();
  await expect(page.getByTestId("flow-value")).toContainText("0.0");
  await page.getByRole("button", { name: "Continue to export" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download runtime ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("plantsketch-runtime.zip");
  const z = await JSZip.loadAsync(readFileSync((await download.path())!));
  expect(z.file("project.json")).not.toBeNull();
  expect(await z.file("simulation.mjs")!.async("string")).toBe(
    readFileSync("lib/simulation.mjs", "utf8"),
  );
  const project = JSON.parse(await z.file("project.json")!.async("string"));
  expect(
    project.hmi.views[0].items.command_start.property.events[0].actparam,
  ).toBe("1");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page
    .locator('input[type=file][accept="application/pdf,image/png,image/jpeg"]')
    .setInputFiles("public/fixtures/clear.png");
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeDisabled();
  expect(failures).toEqual([]);
});
test("ambiguous drawing creates an editable HMI without enabling simulation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("More sample drawings").click();
  await page.getByRole("button", { name: "Ambiguous crossing" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview generated" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open simulation" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Download FUXA project" }),
  ).toBeEnabled();
  await expect(page.getByAltText("Generated FUXA HMI draft")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const draft = page.getByAltText("Generated FUXA HMI draft");
  const fits = await draft.evaluate(
    (img) =>
      img.getBoundingClientRect().width <=
      img.parentElement!.getBoundingClientRect().width,
  );
  expect(fits).toBe(true);
});
test("portable simulation matches actual browser execution", async ({
  page,
}) => {
  await page.goto("/");
  const input = { source: 780, destination: 135 };
  const commands = [
    { pump: true, valve: 67, fault: false },
    { pump: false, valve: 67, fault: false },
    { pump: true, valve: 100, fault: true },
    { pump: true, valve: 100, fault: false },
  ];
  let s = initialState(input.source, input.destination);
  for (const c of commands) for (let i = 0; i < 20; i++) s = step(s, c, 0.25);
  const browser = await page.evaluate(
    async ({ input, commands }) => {
      const url = "/runtime/simulation.mjs";
      const core = await import(url);
      let state = core.initialState(input.source, input.destination);
      for (const c of commands)
        for (let i = 0; i < 20; i++) state = core.step(state, c, 0.25);
      return state;
    },
    { input, commands },
  );
  expect(browser).toEqual(s);
});
test("rejects invalid file and accepts PNG, JPEG and multipage PDF", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator(
    'input[type=file][accept="application/pdf,image/png,image/jpeg"]',
  );
  await input.setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator(".alert.error")).toContainText(
    "Choose a PDF, PNG or JPEG",
  );
  for (const file of ["clear.png", "clear.jpg", "two-pages.pdf"]) {
    await input.setInputFiles("public/fixtures/" + file);
    await expect(
      page.getByAltText("Selected P&ID page before extraction"),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Preparing drawing" }),
    ).toHaveCount(0);
  }
  await page.getByLabel("PDF page").selectOption("2");
  await expect(page.getByLabel("PDF page")).toHaveValue("2");
  await expect(page.locator(".alert.error")).toHaveCount(0);
});
test("anonymous requests reach server-side input validation", async ({
  request,
}) => {
  const r = await request.post("/api/extract", {
    data: { image: "invalid-image", page: 1, name: "test" },
  });
  expect(r.status()).toBe(400);
  expect(await r.json()).toEqual(
    expect.objectContaining({
      error: expect.stringContaining("Invalid image request"),
    }),
  );
});
test("small-screen sample workspace has no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try sample P&ID" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("transparent PNG remains white after JPEG preprocessing", async ({
  page,
}) => {
  await page.goto("/");
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 700;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.strokeRect(100, 100, 300, 250);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator('input[type=file][accept="application/pdf,image/png,image/jpeg"]')
    .setInputFiles({
      name: "transparent.png",
      mimeType: "image/png",
      buffer: Buffer.from(base64, "base64"),
    });
  await expect(
    page.getByAltText("Selected P&ID page before extraction"),
  ).toBeVisible();
  const pixel = await page
    .getByAltText("Selected P&ID page before extraction")
    .evaluate((img: HTMLImageElement) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(10, 10, 1, 1).data);
    });
  expect(pixel.slice(0, 3)).toEqual([255, 255, 255]);
});

test("workspace backup restores edits and clears the previous PDF selection", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type=file][accept="application/pdf,image/png,image/jpeg"]')
    .setInputFiles("public/fixtures/two-pages.pdf");
  await expect(page.getByLabel("PDF page")).toBeVisible();
  const model = JSON.parse(
    readFileSync("public/fixtures/clear.expected.json", "utf8"),
  );
  model.items[0].tag = "TK-901";
  const drawing = {
    image: "/fixtures/clear.svg",
    name: "Saved sample",
    page: 1,
    pages: 1,
    width: 1000,
    height: 700,
  };
  await page
    .locator('input[type=file][accept="application/json"]')
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ model, drawing })),
    });
  await expect(page.locator(".process-svg")).toContainText("TK-901");
  await page.reload();
  await expect(page.locator(".process-svg")).toContainText("TK-901");
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeEnabled();
  // Import again after opening a PDF, without a reload that would clear the File object.
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page
    .locator('input[type=file][accept="application/pdf,image/png,image/jpeg"]')
    .setInputFiles("public/fixtures/two-pages.pdf");
  await expect(page.getByLabel("PDF page")).toBeVisible();
  await page
    .locator('input[type=file][accept="application/json"]')
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ model, drawing })),
    });
  await expect(page.locator(".process-svg")).toContainText("TK-901");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByLabel("PDF page")).toHaveCount(0);
  await expect(
    page.getByAltText("Selected P&ID page before extraction"),
  ).toHaveAttribute("src", "/fixtures/clear.svg");
});

test("extraction failure and cancellation preserve the drawing without sample fallback", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type=file][accept="application/pdf,image/png,image/jpeg"]')
    .setInputFiles("public/fixtures/clear.png");
  await expect(
    page.getByAltText("Selected P&ID page before extraction"),
  ).toBeVisible();
  await expect(page.getByLabel("Access token")).toHaveCount(0);
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "Provider limit; retry later." }),
    }),
  );
  await page.getByRole("button", { name: "Create HMI" }).click();
  await expect(page.locator(".alert.error")).toContainText("Provider limit");
  await expect(
    page.getByRole("button", { name: "HMI", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/extract");
  await page.route("**/api/extract", () => {});
  await page.getByRole("button", { name: "Create HMI" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".alert.error")).toContainText("cancelled");
  await expect(page.getByRole("button", { name: "Create HMI" })).toBeEnabled();
  await expect(
    page.getByAltText("Selected P&ID page before extraction"),
  ).toBeVisible();
});

test("visitors can extract an uploaded drawing without an access token", async ({
  page,
}) => {
  const model = JSON.parse(
    readFileSync("public/fixtures/clear.expected.json", "utf8"),
  );
  model.source = { name: "clear.png", page: 1, mode: "ai" };
  model.items.forEach((item: { review: string }) => {
    item.review = "unreviewed";
  });
  model.connections.forEach((connection: { review: string }) => {
    connection.review = "unreviewed";
  });
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ model }),
    }),
  );
  await page.goto("/");
  await expect(page.getByLabel("Access token")).toHaveCount(0);
  await page
    .locator('input[type=file][accept="application/pdf,image/png,image/jpeg"]')
    .setInputFiles("public/fixtures/clear.png");
  await expect(page.getByRole("button", { name: "Create HMI" })).toBeEnabled();
  const outgoing = page.waitForRequest("**/api/extract");
  await page.getByRole("button", { name: "Create HMI" }).click();
  const request = await outgoing;
  expect(request.headers().authorization).toBeUndefined();
  expect(Object.keys(request.postDataJSON()).sort()).toEqual([
    "image",
    "name",
    "page",
  ]);
  await expect(
    page.getByRole("heading", { name: "Overview generated" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download FUXA project" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Open FUXA editor" }),
  ).toHaveAttribute("href", /1881/);
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download FUXA project" }).click();
  const download = await downloadPromise;
  const project = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(project.hmi.views[0].items.shape_t1.lock).toBe(false);
});
