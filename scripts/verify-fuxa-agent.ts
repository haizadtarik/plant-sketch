// Opt-in live API test. Run only against the dedicated demo FUXA instance.
import { mkdirSync, writeFileSync } from "node:fs";
import { sampleModel } from "../lib/fixtures";
import { runFuxa } from "../lib/computer-use/fuxa";
import type { AgentRun } from "../lib/computer-use/types";
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey)
  throw new Error("OPENAI_API_KEY is required for the opt-in live test.");
const controller = new AbortController();
const timeout = setTimeout(
  () => controller.abort(new Error("Live test time limit reached.")),
  600_000,
);
const run: AgentRun = {
  id: "live-verification",
  status: "running",
  phase: "Starting",
  message: "Starting",
  startedAt: new Date().toISOString(),
  checks: [],
  events: [],
};
const progress = setInterval(
  () => console.log(`${run.phase}: ${run.message}`),
  15000,
);
try {
  await runFuxa({
    plant: sampleModel(),
    run,
    signal: controller.signal,
    apiKey,
    fuxaUrl: process.env.FUXA_AGENT_FUXA_URL || "http://127.0.0.1:1881",
    model: process.env.OPENAI_COMPUTER_MODEL,
    executablePath: process.env.FUXA_AGENT_BROWSER_PATH,
  });
  mkdirSync("test-results/fuxa-agent-live", { recursive: true });
  if (run.screenshot)
    writeFileSync(
      "test-results/fuxa-agent-live/final.png",
      Buffer.from(run.screenshot.split(",")[1], "base64"),
    );
  writeFileSync(
    "test-results/fuxa-agent-live/result.json",
    JSON.stringify({ ...run, screenshot: undefined }, null, 2),
  );
  console.log(
    `${run.status}: ${run.message} (${run.checks.length} verified checks)`,
  );
  if (run.status !== "passed") process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  clearInterval(progress);
}
