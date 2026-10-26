import OpenAI from "openai";
import { chromium, type Page } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import { generateHmi } from "../generate";
import type { Plant } from "../model";
import { allowedBrowserUrl, executeBrowserAction } from "./browser";
import { verifyExport, verifyReadings, type Readings } from "./checks";
import { NeedsAttention, runComputerTask } from "./loop";
import type { AgentRun } from "./types";

export async function runFuxa(options: {
  plant: Plant;
  run: AgentRun;
  signal: AbortSignal;
  fuxaUrl: string;
  apiKey: string;
  model?: string;
  executablePath?: string;
}) {
  const { run, signal } = options;
  const generated = generateHmi(options.plant);
  if (!generated.report.simulationEnabled)
    throw new Error("Only the supported tank-transfer demo can be automated.");
  const origin = new URL(options.fuxaUrl).origin;
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: 60_000,
    maxRetries: 0,
  });
  const browser = await chromium.launch({
    executablePath: options.executablePath,
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(15000);
    let exportValid = false,
      successfulSaves = 0,
      uploaded = false,
      outcome: AgentRun["status"] = "failed",
      handlerError = "",
      activeCheck: (() => Promise<void>) | undefined;
    const log = (message: string) => {
      run.message = message;
      run.events.push(`${new Date().toISOString()} ${message}`);
      if (run.events.length > 100) run.events.shift();
    };
    // Browser network is restricted; API traffic is sent separately by the Node worker.
    await context.route("**/*", (route) =>
      allowedBrowserUrl(route.request().url(), origin)
        ? route.continue()
        : route.abort(),
    );
    await context.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url());
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      if (url.origin === origin) socket.connectToServer();
      else socket.close();
    });
    context.on("page", (popup) => {
      if (popup !== page) void popup.close();
    });
    page.on("dialog", (dialog) => {
      void dialog.dismiss();
    });
    page.on("filechooser", (chooser) => {
      if (uploaded) {
        handlerError = "Unexpected second file import requested.";
        return;
      }
      uploaded = true;
      void chooser
        .setFiles({
          name: "project.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(generated.project)),
        })
        .catch((error) => {
          handlerError = String(error);
        });
    });
    page.on("response", (response) => {
      if (
        new URL(response.url()).pathname === "/api/project" &&
        response.request().method() === "POST" &&
        response.ok()
      )
        successfulSaves++;
    });
    page.on("download", (download) => {
      void (async () => {
        const stream = await download.createReadStream();
        if (!stream) throw new Error("Project download failed.");
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > 5_000_000) {
            stream.destroy();
            throw new Error("Project export exceeds limit.");
          }
          chunks.push(Buffer.from(chunk));
        }
        exportValid = verifyExport(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
          generated,
        );
        if (!exportValid)
          handlerError = "Exported project failed binding verification.";
      })().catch((error) => {
        handlerError = String(error);
      });
    });
    const readings = async (target: Page = page): Promise<Readings> => {
      const result: Readings = {};
      for (const tag of generated.tags.filter(
        (tag) => tag.direction === "telemetry",
      )) {
        const node = target.locator(`#value_${tag.id}`);
        result[tag.key] = (await node.count())
          ? parseFloat((await node.first().textContent()) || "")
          : NaN;
      }
      return result;
    };
    const stopPump = async () => {
      if (!page.url().startsWith(origin + "/home"))
        await page.goto(origin + "/home");
      await page.locator("#command_stop").click({ timeout: 5000 });
      for (let attempt = 0; attempt < 20; attempt++) {
        const values = await readings();
        if (values.pumpRunning === 0 && values.flow === 0) return true;
        await delay(250);
      }
      return false;
    };
    const screenshot = async () => {
      if (handlerError) throw new Error(handlerError);
      if (!allowedBrowserUrl(page.url(), origin))
        throw new Error("Browser left the allowed FUXA origin.");
      const image = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
      run.screenshot = image;
      await activeCheck?.();
      return image;
    };
    const phase = async (
      name: string,
      task: string,
      verify: () => Promise<boolean>,
    ) => {
      signal.throwIfAborted();
      run.phase = name;
      log(name);
      await runComputerTask({
        task,
        signal,
        verify,
        screenshot,
        model: options.model,
        respond: async (request) => {
          const response = await client.responses.create(request, { signal });
          return {
            ...response,
            output: response.output.map((item) =>
              item.type === "computer_call" ? item : { type: item.type },
            ),
          };
        },
        execute: (action) => executeBrowserAction(page, action, signal),
        progress: log,
      });
      run.checks.push({ name });
    };
    try {
      await page.goto(origin + "/editor");
      await phase(
        "Import, configure and save",
        `Import the supplied project.json through FUXA's Open Project file chooser (the host automatically supplies the file when you open the chooser). Use the header Save Project dropdown. Check Connections: Demo MQTT must be enabled with address mqtt://broker:1883. Save Project, then use Save Project As... to download an export for verification. Do not change shapes, tags or bindings. The imported project is named ${JSON.stringify(options.plant.name)}.`,
        async () => uploaded && successfulSaves >= 2 && exportValid,
      );
      await page.reload();
      await page.goto(origin + "/home");
      await phase(
        "MQTT feedback and stopped state",
        "In the viewer, click Stop pump and Valve 50%. Wait for live values. Verify zero flow, pump stopped, valve feedback 50%, and tank levels. Do not start the pump yet.",
        async () => {
          const values = await readings();
          return (
            verifyReadings(values, {
              flow: 0,
              pumpRunning: 0,
              valveFeedback: 50,
            }) &&
            values.sourceLevel > 5 &&
            values.destinationLevel < 95
          );
        },
      );
      for (const opening of [50, 100, 0]) {
        const before = await readings();
        let observed: Readings | undefined;
        const expected = {
          flow: opening / 5,
          pumpRunning: 1,
          valveFeedback: opening,
        };
        activeCheck = async () => {
          if (observed) return;
          // Brief local observation avoids draining the tank while awaiting another model turn.
          for (let attempt = 0; attempt < 5; attempt++) {
            signal.throwIfAborted();
            const values = await readings();
            if (
              verifyReadings(values, expected, opening ? before : undefined)
            ) {
              observed = values;
              if (!(await stopPump()))
                throw new Error("Could not confirm pump stop after the test.");
              return;
            }
            await delay(250, undefined, { signal });
          }
        };
        await phase(
          `Valve ${opening}% and pump response`,
          `Set Valve ${opening}% then click Start pump. Wait for pump running feedback 1 and flow ${opening / 5} L/s. ${opening ? "Tank levels must change in opposite directions." : "The closed valve must keep flow at zero."} The host automatically stops the pump once readings are verified; do not restart it after that.`,
          async () => Boolean(observed),
        );
        run.checks[run.checks.length - 1].readings = observed;
        activeCheck = undefined;
      }
      await phase(
        "Final pump stop",
        "Click Stop pump and Valve 50%. Leave the simulator stopped at zero flow with valve opening 50%.",
        async () =>
          verifyReadings(await readings(), {
            flow: 0,
            pumpRunning: 0,
            valveFeedback: 50,
          }),
      );
      outcome = "passed";
      log(
        "Verified project import/save, MQTT feedback, level transfer, valve 0/50/100%, and pump stop.",
      );
    } catch (error) {
      outcome = signal.aborted
        ? "cancelled"
        : error instanceof NeedsAttention
          ? "needs-attention"
          : "failed";
      log(error instanceof Error ? error.message : String(error));
    } finally {
      activeCheck = undefined;
      run.pumpStopped = uploaded
        ? await stopPump().catch(() => false)
        : undefined;
      if (run.pumpStopped === false) {
        outcome = "needs-attention";
        log(
          "Could not confirm pump stop. Open the demo viewer and stop the pump manually. " +
            run.message,
        );
      }
      run.screenshot = await page
        .screenshot()
        .then((image) => `data:image/png;base64,${image.toString("base64")}`)
        .catch(() => run.screenshot);
      run.finishedAt = new Date().toISOString();
      run.status =
        signal.aborted && outcome !== "needs-attention" ? "cancelled" : outcome;
    }
  } finally {
    await browser.close();
  }
}
