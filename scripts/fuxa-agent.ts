import { createServer } from "node:http";
import { Readable } from "node:stream";
import { AgentService } from "../lib/computer-use/service";
import { runFuxa } from "../lib/computer-use/fuxa";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey)
  throw new Error("Set OPENAI_API_KEY in the worker environment or .env file.");
const fuxaUrl = process.env.FUXA_AGENT_FUXA_URL || "http://127.0.0.1:1881";
const url = new URL(fuxaUrl);
if (
  !["http:", "https:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.username ||
  url.password
)
  throw new Error(
    "FUXA_AGENT_FUXA_URL must point to a local, dedicated FUXA demo instance.",
  );
const service = new AgentService(
  process.env.FUXA_AGENT_TOKEN || "",
  (plant, run, signal) =>
    runFuxa({
      plant,
      run,
      signal,
      fuxaUrl,
      apiKey,
      model: process.env.OPENAI_COMPUTER_MODEL || "gpt-6.1-sol",
      executablePath: process.env.FUXA_AGENT_BROWSER_PATH || undefined,
    }),
);
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers,
      ...(req.method === "POST"
        ? {
            body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
            duplex: "half",
          }
        : {}),
    });
    const response = await service.handle(request);
    res.writeHead(response.status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(await response.text());
  } catch {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Worker request failed." }));
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.FUXA_AGENT_PORT || 1882), "127.0.0.1", () =>
  console.log(
    "FUXA computer-use worker listening on loopback. Use the app's export panel to start a run.",
  ),
);
for (const event of ["SIGTERM", "SIGINT"] as const)
  process.once(event, () => {
    server.close();
    void service.shutdown().finally(() => process.exit(0));
  });
