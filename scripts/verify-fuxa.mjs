// Runs against the dedicated pnid-studio-verification Compose project.
// Uses FUXA's UI for import, editing, save/export and commands; no import API.
import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const bundle = resolve(process.argv[2] || "/tmp/pnid-fuxa-live");
const output = resolve(process.argv[3] || "docs/evidence/fuxa-1.2.9");
mkdirSync(output, { recursive: true });
const project = JSON.parse(readFileSync(join(bundle, "project.json"), "utf8"));
const config = JSON.parse(
  readFileSync(join(bundle, "simulation-config.json"), "utf8"),
);
const compose = [
  "compose",
  "-p",
  "pnid-studio-verification",
  "-f",
  join(bundle, "compose.yaml"),
];
const docker = (...args) =>
  promisify(execFile)("docker", [...compose, ...args]);
await docker("restart", "simulator");
const mqtt = spawn("docker", [
  ...compose,
  "exec",
  "-T",
  "broker",
  "mosquitto_sub",
  "-v",
  "-t",
  "pnid/#",
]);
let messages = "";
mqtt.stdout.on("data", (data) => {
  messages += data.toString();
});
const cached =
  homedir() +
  "/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const browser = await chromium.launch(
  existsSync(cached) ? { executablePath: cached } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10_000);
const errors = [],
  results = [];
page.on("pageerror", (error) => errors.push(error.message));
const tag = (key) => config.tags.find((t) => t.key === key);
const valueLocator = (key) => page.locator("#value_" + tag(key).id);
const value = async (key) => parseFloat(await valueLocator(key).textContent());
const check = async (key, expected, timeout = 10000) =>
  expect.poll(() => value(key), { timeout }).toBe(expected);
const menu = async (label) => {
  await page.getByRole("button", { name: "Save Project", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};
const exported = async (filename) => {
  const pending = page.waitForEvent("download");
  await menu("Save Project As...");
  await (await pending).saveAs(join(output, filename));
  return JSON.parse(readFileSync(join(output, filename), "utf8"));
};
try {
  await page.goto("http://127.0.0.1:1881/editor");
  await page.getByRole("button", { name: "Save Project", exact: true }).click();
  const imported = page.waitForResponse(
    (r) => r.url().endsWith("/api/project") && r.request().method() === "POST",
  );
  await page
    .locator("#projectFileUpload")
    .setInputFiles(join(bundle, "project.json"));
  assert.equal((await imported).status(), 200);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Views", exact: true }),
  ).toContainText("Overview (simulated)");
  const reference = await exported("reference-editor-export.json");
  assert.equal(reference.version, "1.01");
  for (const [id, gauge] of Object.entries(project.hmi.views[0].items)) {
    assert.equal(
      reference.hmi.views[0].items[id].property.variableId,
      gauge.property.variableId,
    );
  }
  results.push(
    "UI import, editor rendering and native JSON export preserve every widget binding",
  );
  const tankId =
    "shape_" +
    JSON.parse(
      readFileSync(join(bundle, "plant-model.json"), "utf8"),
    ).items.find((i) => i.kind === "tank").id;
  const flowId = "value_" + tag("flow").id;
  const edits = [];
  for (const [id, field] of [
    [tankId, "selected_x"],
    [flowId, "selected_y"],
  ]) {
    await page.locator("#" + id).click();
    await expect(page.locator("#gaugename")).toHaveValue(id);
    const input = page.locator("#" + field);
    const before = Number(await input.inputValue());
    await input.fill(String(before + 8));
    await input.press("Enter");
    await expect(input).toHaveValue(String(before + 8));
    edits.push({ id, field, before, after: before + 8 });
  }
  await menu("Save Project");
  await page.reload();
  for (const edit of edits) {
    await page.locator("#" + edit.id).click();
    await expect(page.locator("#" + edit.field)).toHaveValue(
      String(edit.after),
    );
  }
  const edited = await exported("edited-editor-export.json");
  assert.notEqual(
    edited.hmi.views[0].svgcontent,
    reference.hmi.views[0].svgcontent,
  );
  await page.screenshot({ path: join(output, "editor-edited.png") });
  results.push(
    "Tank and numeric display independently edited, saved, reloaded and exported through native editor",
  );
  console.log(results.join("\n"));
  await page.goto("http://127.0.0.1:1881/home");
  await check("sourceLevel", 80);
  await check("destinationLevel", 20);
  await check("pumpRunning", 0);
  await check("pumpFault", 0);
  await check("valveFeedback", 50);
  await page.locator("#command_start").click();
  await check("flow", 10);
  await check("pumpRunning", 1);
  await expect.poll(() => value("sourceLevel")).toBeLessThan(80);
  await expect.poll(() => value("destinationLevel")).toBeGreaterThan(20);
  await page.screenshot({ path: join(output, "viewer-running.png") });
  const levels = [await value("sourceLevel"), await value("destinationLevel")];
  assert(Math.abs(levels[0] + levels[1] - 100) <= 0.2);
  await page.locator("#command_open").click();
  await check("flow", 20);
  await check("valveFeedback", 100);
  await page.locator("#command_close").click();
  await check("flow", 0);
  await check("valveFeedback", 0);
  await page.locator("#command_half").click();
  await check("flow", 10);
  await check("valveFeedback", 50);
  await page.locator("#command_stop").click();
  await check("flow", 0);
  await check("pumpRunning", 0);
  results.push(
    "Live MQTT pump start/stop, 0/50/100% valve commands, running/fault feedback and changing levels",
  );
  console.log(results.at(-1));
  await page.locator("#command_open").click();
  await page.locator("#command_start").click();
  await check("sourceLevel", 0, 50000);
  await check("destinationLevel", 100);
  await check("flow", 0);
  await check("pumpRunning", 0);
  await page.screenshot({ path: join(output, "viewer-transfer-complete.png") });
  results.push(
    "Transfer stops at empty source/full destination; displayed total volume conserved",
  );
  console.log(results.at(-1));
  await docker("restart", "simulator");
  await check("sourceLevel", 80);
  await check("destinationLevel", 20);
  await check("pumpRunning", 0);
  await check("valveFeedback", 50);
  for (const command of [
    "pumpCommand 1",
    "pumpCommand 0",
    "valveCommand 0",
    "valveCommand 50",
    "valveCommand 100",
  ]) {
    assert(
      messages.includes("pnid/command/" + command),
      "Missing MQTT command: " + command,
    );
  }
  assert(messages.includes("pnid/telemetry/flow 20"));
  assert(messages.includes("pnid/telemetry/pumpRunning 1"));
  assert.deepEqual(errors, []);
  results.push(
    "Simulator restart restores 800/200 L defaults; broker observer proves separate command and telemetry topics",
  );
  writeFileSync(
    join(output, "verification.json"),
    JSON.stringify(
      {
        version: "1.2.9",
        date: new Date().toISOString(),
        results,
        edits,
        pageErrors: errors,
        observedCommandMessages: messages
          .split("\n")
          .filter((l) => l.startsWith("pnid/command/")),
      },
      null,
      2,
    ),
  );
  console.log("PASS: " + results.length + " live FUXA acceptance groups");
} finally {
  writeFileSync(join(output, "mqtt-observation.log"), messages);
  await page
    .screenshot({ path: join(output, "final-state.png") })
    .catch(() => {});
  await browser.close();
  mqtt.kill("SIGTERM");
}
