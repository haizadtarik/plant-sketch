import { describe, it, expect } from "vitest";
import { sampleModel } from "../lib/fixtures";
import { bundle } from "../lib/export";
import { generateHmi } from "../lib/generate";

describe("direct FUXA HMI generation", () => {
  it("creates editable widgets without requiring extraction review", () => {
    const m = sampleModel();
    m.items.forEach((i) => (i.review = "unreviewed"));
    m.connections.forEach((e) => (e.review = "unreviewed"));
    m.assumptions.forEach((a) => (a.status = "unresolved"));
    const g = generateHmi(m);
    expect(g.project.hmi.views[0].items.shape_t1.lock).toBe(false);
    expect(m.items[0].review).toBe("unreviewed");
    expect(g.report.humanReviewed).toBe(false);
  });
  it("retains ambiguous issues and creates a static HMI for other topologies", () => {
    const m = sampleModel("ambiguous");
    m.items = m.items.slice(0, 1);
    m.items[0].kind = "unsupported";
    m.connections = [];
    const g = generateHmi(m);
    expect(g.project.hmi.views[0].items.shape_t1).toBeDefined();
    expect(g.tags).toEqual([]);
    expect(g.report.issues).toEqual(m.issues);
    expect(g.report.simulationEnabled).toBe(false);
  });
  it("omits the simulator from ambiguous draft runtime bundles", async () => {
    const zip = await bundle(
      sampleModel("ambiguous"),
      "export function step() {}",
    );
    const compose = await zip.file("compose.yaml")!.async("string");
    expect(compose).toContain("  fuxa:");
    expect(compose).not.toContain("  simulator:");
    expect(
      JSON.parse(await zip.file("report.json")!.async("string"))
        .simulationEnabled,
    ).toBe(false);
  });
  it("rejects dangling links instead of crashing the renderer", () => {
    const m = sampleModel();
    m.connections[0].to = "missing";
    expect(() => generateHmi(m)).toThrow("Invalid endpoints");
  });
});
