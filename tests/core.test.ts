import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sampleModel } from "../lib/fixtures";
import { validatePlant, PlantSchema, supportedTopology } from "../lib/model";
import { generate } from "../lib/generate";
import { initialState, step } from "../lib/simulation.mjs";
import { bundle } from "../lib/export";
describe("review and generation", () => {
  it("includes the enabled internal FUXA device required by runtime status callbacks", () => {
    const project = generate(sampleModel()).project;
    expect(project.devices["0"]).toMatchObject({
      id: "0",
      type: "FuxaServer",
      enabled: true,
      tags: {},
    });
  });
  it("puts widgets in a named SVG editor layer rather than one opaque group", () => {
    const svg = generate(sampleModel()).project.hmi.views[0].svgcontent;
    expect(svg).toContain('<g id="layer_overview"><title>Overview</title>');
    expect(svg).not.toContain('id="svgcontent"');
  });
  it("fixture arrows agree with their expected process directions", () => {
    for (const variant of ["clear", "alternate"]) {
      const m = sampleModel(variant);
      const svg = readFileSync(`public/fixtures/${variant}.svg`, "utf8");
      const arrows = [
        ...svg.matchAll(/<path d="M[-\d.]+ [-\d.]+ l([-\d.]+) 4 [-\d.]+ 4"/g),
      ];
      const edges = m.connections.filter((e) => e.type === "process");
      expect(arrows).toHaveLength(edges.length);
      edges.forEach((e, n) => {
        const from = m.items.find((i) => i.id === e.from)!.bbox.x;
        const to = m.items.find((i) => i.id === e.to)!.bbox.x;
        expect(Math.sign(Number(arrows[n][1]))).toBe(Math.sign(to - from));
      });
    }
  });
  it("validates all reviewed fixtures", () => {
    for (const id of ["clear", "alternate"])
      expect(validatePlant(sampleModel(id))).toEqual([]);
  });
  it("keeps ambiguous fixture blocked", () =>
    expect(validatePlant(sampleModel("ambiguous")).length).toBeGreaterThan(0));
  it("rejects malformed source bounds", () => {
    const m = sampleModel();
    m.items[0].bbox.x = 2;
    expect(PlantSchema.safeParse(m).success).toBe(false);
  });
  it("detects duplicates, dangling edges and invalid ranges", () => {
    const m = sampleModel();
    m.items[1].tag = m.items[0].tag;
    m.connections[0].to = "missing";
    m.items[0].range = { min: 10, max: 0 };
    expect(validatePlant(m).length).toBeGreaterThanOrEqual(3);
  });
  it("only enables exact supported topology", () => {
    const m = sampleModel();
    expect(supportedTopology(m).ok).toBe(true);
    m.connections.push({
      ...m.connections[0],
      id: "extra",
      from: "t2",
      to: "p1",
    });
    expect(supportedTopology(m).ok).toBe(false);
  });
  it("is deterministic with valid bindings", () => {
    const a = generate(sampleModel());
    expect(generate(sampleModel())).toEqual(a);
    const ids = new Set(a.tags.map((t) => t.id));
    for (const w of Object.values(a.project.hmi.views[0].items)) {
      if (w.property.variableId)
        expect(ids.has(w.property.variableId)).toBe(true);
    }
  });
  it("binds every symbol and pump color to running feedback", () => {
    const m = sampleModel(),
      g = generate(m),
      gauges = g.project.hmi.views[0].items;
    for (const i of m.items)
      expect(gauges[`shape_${i.id}`].property.variableId).toBeTruthy();
    expect(gauges.shape_p1.property.variableId).toBe("tag_p1_pumpRunning");
  });
  it("requires acceptance of demo assumptions", () => {
    const m = sampleModel();
    m.assumptions[0].status = "unresolved";
    expect(() => generate(m)).toThrow("assumption");
  });
  it("exports the event keys consumed by FUXA's mouse and action dispatch", () => {
    // Pinned v1.2.9: GaugeBaseComponent.getEvents compares enum keys,
    // and FuxaViewComponent.runEvents indexes Object.keys(GaugeEventActionType).
    const widgets = generate(sampleModel()).project.hmi.views[0].items;
    for (const id of ["start", "stop", "open", "half", "close"]) {
      expect(widgets[`command_${id}`].property.events).toEqual([
        expect.objectContaining({ type: "click", action: "onSetValue" }),
      ]);
    }
  });
  it("exports the runtime and reviewed artifacts", async () => {
    const z = await bundle(sampleModel(), "export function step(){}");
    expect(Object.keys(z.files)).toEqual(
      expect.arrayContaining([
        "project.json",
        "plant-model.json",
        "tags.csv",
        "report.json",
        "compose.yaml",
        "simulator.mjs",
        "simulation.mjs",
        "README.md",
        "mosquitto.conf",
      ]),
    );
  });
});
describe("tank transfer", () => {
  it("conserves volume and respects boundaries", () => {
    let s = initialState(800, 200);
    for (let i = 0; i < 2000; i++)
      s = step(s, { pump: true, valve: 100, fault: false }, 1);
    expect(s.source + s.destination).toBeCloseTo(1000);
    expect(s.source).toBe(0);
    expect(s.destination).toBe(1000);
    expect(s.flow).toBe(0);
  });
  it("stop, fault, closed valve prohibit flow", () => {
    for (const c of [
      { pump: false, valve: 100, fault: false },
      { pump: true, valve: 100, fault: true },
      { pump: true, valve: 0, fault: false },
    ])
      expect(step(initialState(), c, 1).flow).toBe(0);
  });
  it("uses elapsed time and deterministic same core", () => {
    let s = initialState();
    for (let i = 0; i < 10; i++)
      s = step(s, { pump: true, valve: 50, fault: false }, 0.1);
    expect(s.source).toBeCloseTo(
      step(initialState(), { pump: true, valve: 50, fault: false }, 1).source,
    );
  });
});
