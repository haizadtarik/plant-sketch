# PlantSKetch

A working Next.js engineering workspace for one-page P&IDs: upload → create HMI → edit in FUXA → export. Sample mode works without credentials. The exported Docker bundle is separate from the Vercel application.

## Local setup

Use Node.js 22.15+ (Node 24 also supported) and npm.

```sh
npm ci --legacy-peer-deps
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 and select **Try sample P&ID**, or upload a drawing, select its PDF page if needed, and click **Create HMI**. The app interprets the drawing and creates an editable FUXA project immediately, without an extraction review or confirmation screen. Select **Download FUXA project**, then **Open FUXA editor**. In FUXA, use Open project to import `project.json`, correct shapes, tags and connections, and Save. Set `NEXT_PUBLIC_FUXA_URL` to your FUXA instance (defaults to `http://localhost:1881/editor`). The app generates the project file; it does not automatically import into a running FUXA server.

The supported tank-transfer topology also offers a simulation preview and Docker runtime bundle. Other detected topologies generate a static editable HMI with no inferred live bindings or simulation commands. Unresolved issues remain in the report and do not block creating the HMI. Changing the source drawing clears previous generated artifacts; imported and restored models generate their HMI automatically.

Sample drawings and expected models are in `public/fixtures/`. Three fixtures are provided: clear transfer, ambiguous crossing, and alternate arrangement held out of extraction development. PNG/JPEG/PDF versions are included. SVGs are bundled fixture assets, not an accepted user upload format.

Workspace data is stored only in this browser's local storage. There is no durable server storage. Use **Backup** and **Import backup** to move or preserve drawings and models. Import also accepts standalone plant-model JSON; it then has no source image. Secrets are never saved in browser storage. Drawing requests go to the selected AI provider for real extraction.

## AI extraction

Set these server variables in `.env.local` or Vercel project settings:

- `OPENAI_API_KEY`: provider credential, never a `NEXT_PUBLIC_` variable.
- `OPENAI_MODEL`: defaults to `gpt-6-astra`. A replacement must support image inputs, the Responses API and strict JSON-schema structured outputs.

Anyone with the application link can upload a drawing and run extraction without signing in or entering an access token. The server uses its configured `OPENAI_API_KEY`; visitors never receive that key. Provider usage is charged to the server API account.

The default model's [official capabilities](https://developers.openai.com/api/docs/models/gpt-6-astra) include image input and structured outputs. The server adapter uses the [Responses API](https://developers.openai.com/api/docs/guides/images-vision) with a Zod-derived JSON schema. It validates again at runtime and tries at most twice for malformed output. Provider automatic retries are disabled. Each provider request has an 80-second timeout; the route has a 90-second overall abort and the browser 100 seconds. Users can cancel. Provider failures, rate limits and invalid output return actionable errors; real extraction never falls back to a sample.

AI evidence, uncertainty and provenance remain in the extracted model and report; automatic generation does not mark detections as human-reviewed. Unknown ranges/units remain null and unknown flow direction stays unknown. Unsupported symbols become editable placeholder shapes. Corrections happen in the FUXA editor. The simulator's explicit template assumptions are separate from drawing evidence.

## Deploy to Vercel

1. Push this repository to your Git provider and import it in Vercel.
2. Select the Next.js preset and a supported Node.js 22+ version. Install command: `npm ci --legacy-peer-deps`. Build command: `npm run build`. No custom output directory.
3. Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` for real extraction, or leave the key unset for sample-only deployment. To let anyone with the production URL use the app, configure the Vercel deployment for public access.
4. Deploy. Test the sample workflow first, then upload a drawing and extract it without credentials in the browser. A missing server API key returns an actionable configuration error.

No Vercel deployment has been performed by this implementation. The extraction route explicitly uses Node.js and `maxDuration = 120`; choose a Vercel plan/runtime configuration supporting that duration. PDF rendering and image preprocessing occur in the browser; native PDF/canvas modules are absent from the extraction route's dependency tree. The application does not run FUXA, MQTT, Docker or a persistent simulator inside Functions.

[Vercel's request/response limit](https://vercel.com/docs/functions/limitations) is 4.5 MB. The application enforces a 3,800,000-byte total JSON body budget on both client and server, including base64 and metadata, below that limit. Upload input limit is 20 MB; raster images max 40 megapixels; normalized raster dimensions max 2600 px and minimum 700 × 400. PDF pages are rendered individually. If compression cannot meet the budget while retaining these dimensions, extraction is blocked with recovery instructions. Pixel dimensions do not guarantee small text is readable; inspect the selected page before extraction. Function duration conventions were checked against [official Vercel documentation](https://vercel.com/docs/functions/configuring-functions/duration) and Next.js installed documentation.

## Exported FUXA runtime

Use **Export → Download runtime ZIP**, unzip it, then:

```sh
docker compose up --build -d
```

Open http://localhost:1881. In the FUXA editor use the header's **Open project** control to load `project.json`, then **Save**. This manual workflow is backed by the pinned FUXA source; no headless import endpoint or autoload is claimed. Open the viewer and use pump start/stop and valve preset controls. In Connections, `Demo MQTT` should connect to `mqtt://broker:1883`. The simulator publishes separate telemetry topics and subscribes to command topics.

The bundle includes the extracted plant JSON, FUXA project JSON, CSV tags, validation report, Docker Compose, broker configuration, pinned FUXA Dockerfile, Node simulator and its exact shared simulation core. Broker is internal; FUXA binds to localhost. Build requires internet access and may take several minutes. Restart the simulator service to reset it. `docker compose down` stops it; persistent FUXA state remains in named volumes.

**Verified in running FUXA 1.2.9 on Docker Linux arm64, 6 October 2026.** The generated project passed UI import, rendering, independent tank/display editing, save/export/reload, live MQTT values, pump start/stop, valve 0/50/100%, empty/full transfer limits and simulator restart. Retained MQTT command replays are ignored when the simulator subscribes, so reset restores pump stopped and valve 50%. See [compatibility evidence and reproducible checks](docs/FUXA-COMPATIBILITY.md), including real FUXA editor exports. This covers the supported demo template and pinned version; other versions/platforms and real plant control are outside these checks.

## OpenAI computer-use setup and testing

The export screen includes **Set up and test in FUXA** for the supported tank-transfer demo. A separate local worker uses the OpenAI Responses API `computer` tool to operate an isolated Playwright browser. It imports the generated project through FUXA's file chooser, checks the MQTT connection, saves and exports the project, then operates the pump and valve controls. The calculation remains in the existing simulator.

1. Download and start the Docker runtime as described above. Use a **dedicated demo FUXA instance**: the run replaces its active project. Restart its simulator before each run so the source tank has enough liquid: `docker compose restart simulator` from the runtime directory.
2. Run `npm install` and `npx playwright install chromium` in this repository. The worker uses the local development installation, including `tsx`.
3. In `.env` or `.env.local`, configure `OPENAI_API_KEY`, `FUXA_AGENT_URL=http://127.0.0.1:1882`, and a private `FUXA_AGENT_TOKEN` of at least 24 characters. Generate a token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Optionally set `OPENAI_COMPUTER_MODEL` (default `gpt-6.1-sol`, which must support the `computer` tool), `FUXA_AGENT_FUXA_URL` (default `http://127.0.0.1:1881`), or `FUXA_AGENT_BROWSER_PATH`.
4. Start `npm run fuxa:agent` in a separate terminal. Restart the Next.js app after configuring `FUXA_AGENT_URL`.
5. Generate the HMI, go to **Export**, enter the worker token and select **Set up and test in FUXA**. The token stays in browser memory. Screenshots are sent to OpenAI and API usage is billed to the worker's key.

The worker permits one active run and restricts browser HTTP/WebSocket access to the configured local FUXA origin. The API key stays in the worker process. The Next.js route is only an authenticated proxy; it never launches a browser. A Vercel deployment cannot reach a worker on your laptop's loopback address: use this workflow with the local Next.js app. The downloaded Docker ZIP continues to work independently and does not contain the worker or credentials.

Completion requires independent checks of the exported bindings, command topics, MQTT address, numeric feedback, changing tank levels and conservation, valve 0/50/100%, and stopped pump. The worker automatically stops the pump after each observed running test so it does not drain while the next model response is pending. This is a deterministic cleanup action; the model performs import, configuration and test control actions through the UI. This run does not test empty/full limits or simulator restart. A model's final answer alone cannot pass a run.

**Stop agent** aborts the API loop and attempts to stop the demo pump. Runs have a ten-minute deadline, a 30-response limit per phase, and a 200-action limit per phase. Pending model safety checks produce **needs attention** without automatically acknowledging them. If pump stop cannot be confirmed, stop it manually in the demo viewer. Closing the page attempts cancellation; if the connection drops, click the start button after reconnecting to recover the worker's active run. Completed run evidence, including the final screenshot, can be downloaded; recent results are held only in worker memory (up to 20 runs, pruned after an hour when another run starts).

Tests for the loop, service, verification and UI run without OpenAI calls. To exercise the real model against the dedicated demo, reset the simulator and run `npm run verify:fuxa-agent`. This opt-in command incurs API usage and writes results to `test-results/fuxa-agent-live/`. API guidance: [OpenAI computer use](https://developers.openai.com/api/docs/guides/tools-computer-use).

## Model, simulation and scope

`lib/model.ts` defines the versioned Zod model, evidence, normalized bounds, internal IDs and tags, provenance and typed relationships. `generateHmi` requires schema validity, unique IDs and valid link endpoints so the project is renderable, but does not require review confirmation, resolved issues or assumption acceptance. Simulation additionally requires the exact directed tank → pump → valve → tank topology with two level instruments and one flow instrument. Other graphs receive an editable static HMI.

`lib/symbols.ts` provides reusable SVG templates. Layout ranks equipment by drawing x coordinate and uses fixed readable slots; measurement instruments are arranged on a separate row. Browser preview and project export share this layout. No custom drag-and-drop editor is included; FUXA provides actual project editing.

`lib/simulation.mjs` is the same ESM logic used in the browser and downloaded Node process. Demo assumptions: 1000 L tanks, 20 L/s maximum, linear valve response, 800/200 L initial volumes, fixed 250 ms logical steps. The flow is bounded by available source volume and destination capacity. Empty source/full receiver stops transfer. Stop, closed valve or pump fault stops flow. There is no noise, PID, inferred alarms or real process control. Browser initial-condition controls apply on reset; runtime intentionally starts at documented defaults. It is not a validated digital twin.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

End-to-end tests cover direct HMI creation, changing values, fault stopping flow, ZIP download, artifact invalidation, ambiguous draft generation, browser/Node parity, upload formats, PDF page selection, anonymous extraction requests and small-screen overflow. Unit tests cover model/graph constraints, determinism, binding integrity, simulation conservation and export contents. See [verification status](docs/VERIFICATION.md) for checks actually executed.

To exercise the real provider, first configure the server environment and restart the app, then explicitly opt in:

```sh
PNID_LIVE_EXTRACTION=1 npx playwright test tests/e2e/live-extraction.spec.ts
```

This incurs API usage. Normal test runs skip these three live tests. They upload the clear PNG, held-out alternate PDF and ambiguous PNG through the browser and download an editable FUXA project without any review step. Raw extraction responses and HMI screenshots are saved under `test-results/`. Existing historical accuracy and runtime evidence describes the prior model and supported demo template; it does not establish GPT-6 Astra extraction accuracy or runtime compatibility for arbitrary drafts.
