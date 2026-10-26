import { describe, expect, it } from "vitest";
import { allowedBrowserUrl, browserKey } from "../lib/computer-use/browser";
import { verifyExport, verifyReadings } from "../lib/computer-use/checks";
import { generateHmi } from "../lib/generate";
import { sampleModel } from "../lib/fixtures";

describe("FUXA independent verification", () => {
  it("rejects a saved project that lost a binding or changed MQTT destination", () => {
    const generated = generateHmi(sampleModel());
    expect(verifyExport(generated.project, generated)).toBe(true);
    const edited = structuredClone(generated.project);
    delete edited.hmi.views[0].items.shape_p1.property.variableId;
    expect(verifyExport(edited, generated)).toBe(false);
    const redirected = structuredClone(generated.project);
    redirected.devices.d_mqtt.property.address = "mqtt://other:1883";
    expect(verifyExport(redirected, generated)).toBe(false);
  });
  it("requires observed transfer as well as the expected flow and pump feedback", () => {
    const expected = { flow: 10, valveFeedback: 50, pumpRunning: 1 };
    const before = { sourceLevel: 80, destinationLevel: 20 };
    expect(
      verifyReadings(
        { ...expected, sourceLevel: 79, destinationLevel: 21, pumpFault: 0 },
        expected,
        before,
      ),
    ).toBe(true);
    expect(
      verifyReadings(
        { ...expected, ...before, pumpFault: 0 },
        expected,
        before,
      ),
    ).toBe(false);
    expect(
      verifyReadings(
        { ...expected, sourceLevel: 79, destinationLevel: 20, pumpFault: 0 },
        expected,
        before,
      ),
    ).toBe(false);
    expect(
      verifyReadings(
        { ...expected, sourceLevel: NaN, destinationLevel: 21, pumpFault: 0 },
        expected,
        before,
      ),
    ).toBe(false);
  });
  it("allows only the configured browser origin, including its port", () => {
    const origin = "http://127.0.0.1:1881";
    expect(allowedBrowserUrl(origin + "/editor", origin)).toBe(true);
    for (const url of [
      "https://evil.test",
      "http://127.0.0.1:1882",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ])
      expect(allowedBrowserUrl(url, origin)).toBe(false);
    expect(browserKey("CTRL")).toBe("Control");
    expect(browserKey("ARROWDOWN")).toBe("ArrowDown");
  });
});
