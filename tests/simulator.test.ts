import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { simulatorSource } from "../lib/export";
import { tagsFor } from "../lib/generate";
import { sampleModel } from "../lib/fixtures";

it("exported Node adapter ignores retained commands but applies fresh commands", () => {
  const root = mkdtempSync(join(tmpdir(), "pnid-simulator-"));
  try {
    mkdirSync(join(root, "node_modules/mqtt"), { recursive: true });
    writeFileSync(
      join(root, "node_modules/mqtt/package.json"),
      JSON.stringify({ type: "module", exports: "./index.mjs" }),
    );
    // Substitute only the MQTT transport and clock. Execute the exact exported
    // simulator and shared simulation core in a real Node process.
    writeFileSync(
      join(root, "node_modules/mqtt/index.mjs"),
      `
const handlers = {}, values = {}, snapshots = [];
const client = { on(name, fn) { handlers[name] = fn; }, subscribe() {}, publish(topic, value) { values[topic.split('/').at(-1)] = Number(value); }, end() {} };
globalThis.setInterval = tick => {
  queueMicrotask(() => {
    const send = (key, value, retain) => handlers.message('pnid/command/' + key, Buffer.from(String(value)), { retain });
    send('pumpCommand', 1, true); send('valveCommand', 100, true); tick(); snapshots.push({...values});
    send('pumpCommand', 1, false); send('valveCommand', 100, false); tick(); snapshots.push({...values});
    send('pumpCommand', 0, false); tick(); snapshots.push({...values});
    console.log(JSON.stringify(snapshots));
  });
};
export default { connect() { return client; } };
`,
    );
    writeFileSync(join(root, "simulator.mjs"), simulatorSource);
    writeFileSync(
      join(root, "simulation.mjs"),
      readFileSync("lib/simulation.mjs"),
    );
    writeFileSync(
      join(root, "simulation-config.json"),
      JSON.stringify({
        initial: { source: 800, destination: 200 },
        tags: tagsFor(sampleModel()),
      }),
    );
    const result = JSON.parse(
      execFileSync(process.execPath, [join(root, "simulator.mjs")], {
        encoding: "utf8",
        timeout: 5000,
      }),
    );
    expect(result[0]).toMatchObject({
      sourceLevel: 80,
      destinationLevel: 20,
      pumpRunning: 0,
      flow: 0,
      valveFeedback: 50,
    });
    expect(result[1]).toMatchObject({
      sourceLevel: 79.5,
      destinationLevel: 20.5,
      pumpRunning: 1,
      flow: 20,
      valveFeedback: 100,
    });
    expect(result[2]).toMatchObject({
      sourceLevel: 79.5,
      destinationLevel: 20.5,
      pumpRunning: 0,
      flow: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
