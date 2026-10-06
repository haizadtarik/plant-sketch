import JSZip from "jszip";
import { Plant } from "./model";
import { generateHmi, GeneratedTag } from "./generate";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const cell = (v: string) =>
  '"' + (/^[=+@-]/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"';
export function tagCsv(tags: GeneratedTag[]) {
  return [
    "id,name,itemId,key,topic,direction,unit,provenance",
    ...tags.map((t) =>
      [
        t.id,
        t.name,
        t.itemId,
        t.key,
        t.topic,
        t.direction,
        t.unit,
        t.provenance,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
}
export const compose = `services:
  fuxa:
    build: ./fuxa
    ports: ["127.0.0.1:1881:1881"]
    volumes:
      - fuxa_data:/data/_appdata
      - fuxa_db:/data/_db
    depends_on: [broker]
  broker:
    image: eclipse-mosquitto:2.0.20
    volumes: ["./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro"]
  simulator:
    build: ./simulator
    environment:
      MQTT_URL: mqtt://broker:1883
    volumes:
      - ./simulator.mjs:/app/simulator.mjs:ro
      - ./simulation.mjs:/app/simulation.mjs:ro
      - ./simulation-config.json:/app/simulation-config.json:ro
    depends_on: [broker]
volumes:
  fuxa_data:
  fuxa_db:
`;
export const runtimeReadme = `# PlantSKetch runtime — demonstration only

Requires Docker Desktop / Docker Engine with Compose. Run from this directory:

    docker compose up --build -d

Open http://localhost:1881. Enter the FUXA editor, use the header's Open project control to select project.json, then Save. The pinned source header calls setProject(project,true); no undocumented autoload endpoint is used. Use the viewer to operate Start pump, Stop pump and valve preset buttons. Use the editor to edit native SVG shapes and tag properties.

Device Demo MQTT must be enabled, address mqtt://broker:1883. Connection should become green. Levels, flow, pump feedback/fault and valve feedback arrive via raw scalar MQTT topics. Commands use separate pnid/command/* topics, telemetry uses pnid/telemetry/*. Simulator defaults: 800 / 200 L, 1000 L capacity, 20 L/s maximum, linear valve opening. Empty source/full receiving tank stops transfer. These are demo assumptions, not a digital twin or inferred process control.

FUXA pinned to v1.2.9, source commit 19c2471833e410eea235b81857ddcfde7b3851a0. Project v1.01, native svg-ext-shapes / svg-ext-value gauge structures, raw MQTT reads/writes and shape click events inspected from that source. Image built from pinned npm package rather than an unverified Docker tag.

Verified on 6 October 2026 in FUXA 1.2.9, Node 22.15.0, Docker Linux arm64: UI import, independent tank/display editing, save/export/reload, live MQTT values, pump start/stop, valve 0/50/100%, transfer limits and simulator restart. Native editor exports, screenshots and MQTT observations are retained in docs/evidence/fuxa-1.2.9 in the source repository. Verification covers this supported demo template and pinned version, not real plant control or other FUXA versions.

Broker is internal to the Compose network; FUXA binds only to localhost. No real PLCs. Restart simulator to reset state. Retained command replays are ignored, so restart restores pump stopped and valve 50%; click controls again to issue fresh commands. Stop with docker compose down. Remove volumes only if you deliberately want to delete FUXA changes.
`;
export const simulatorSource = `import mqtt from 'mqtt';
import { readFileSync } from 'node:fs';
import { initialState, step, telemetry } from './simulation.mjs';
const config=JSON.parse(readFileSync(new URL('./simulation-config.json',import.meta.url),'utf8'));
const client=mqtt.connect(process.env.MQTT_URL||'mqtt://broker:1883',{reconnectPeriod:1000});
let state=initialState(config.initial.source,config.initial.destination),command={pump:false,valve:50,fault:false};
client.on('connect',()=>client.subscribe(config.tags.filter(t=>t.direction==='command').map(t=>t.topic)));
// FUXA retains command topics. Ignore subscription replays so restart does not replay an old Start.
client.on('message',(topic,payload,packet)=>{if(packet.retain)return;const tag=config.tags.find(t=>t.topic===topic&&t.direction==='command');const value=Number(payload.toString());if(!tag||!Number.isFinite(value))return;if(tag.key==='pumpCommand'&&(value===0||value===1))command.pump=value===1;if(tag.key==='valveCommand')command.valve=Math.min(100,Math.max(0,value));});
client.on('error',e=>console.error('MQTT:',e.message));
// Fixed 250 ms logical step, shared exactly with browser. No random behavior.
setInterval(()=>{state=step(state,command,.25);const values=telemetry(state,command);for(const tag of config.tags.filter(t=>t.direction==='telemetry'))client.publish(tag.topic,String(values[tag.key]),{retain:true});},250);
process.on('SIGTERM',()=>client.end());
`;
export async function bundle(m: Plant, coreSource: string) {
  const g = generateHmi(m),
    zip = new JSZip();
  zip.file("project.json", json(g.project));
  zip.file("plant-model.json", json(m));
  zip.file("tags.csv", tagCsv(g.tags));
  zip.file("report.json", json(g.report));
  zip.file(
    "compose.yaml",
    g.report.simulationEnabled
      ? compose
      : compose
          .replace("    depends_on: [broker]", "")
          .replace(
            /  simulator:[\s\S]*?volumes:\n  fuxa_data:/,
            "volumes:\n  fuxa_data:",
          ),
  );
  zip.file(
    "README.md",
    runtimeReadme +
      (g.report.simulationEnabled
        ? ""
        : "\nThis drawing is an editable static HMI draft. The simulator service is omitted, and no live tags or command bindings are generated. Correct the drawing and configure devices and bindings directly in FUXA.\n"),
  );
  zip.file(
    "mosquitto.conf",
    "listener 1883\nallow_anonymous true\npersistence false\n",
  );
  zip.file("simulator.mjs", simulatorSource);
  zip.file("simulation.mjs", coreSource);
  zip.file(
    "simulation-config.json",
    json({
      initial: { source: 800, destination: 200 },
      parameters: { capacity: 1000, maxFlow: 20 },
      tags: g.tags,
    }),
  );
  zip.file(
    "simulator/Dockerfile",
    'FROM node:22.15.0-alpine\nWORKDIR /app\nRUN npm install --omit=dev mqtt@5.10.4\nCMD ["node", "simulator.mjs"]\n',
  );
  zip.file(
    "fuxa/Dockerfile",
    'FROM node:22.15.0-bookworm\nRUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 unixodbc-dev && rm -rf /var/lib/apt/lists/*\nRUN npm install -g --unsafe-perm @frangoteam/fuxa@1.2.9\nWORKDIR /data\nEXPOSE 1881\nCMD ["node", "/usr/local/lib/node_modules/@frangoteam/fuxa/main.js", "--userDir", "/data"]\n',
  );
  return zip;
}
