import { describe, it, expect, vi, beforeEach } from "vitest";
import { sampleModel } from "../lib/fixtures";
import { APIConnectionTimeoutError } from "openai";
const create = vi.hoisted(() => vi.fn());
vi.mock("openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openai")>()),
  default: class {
    responses = { create };
  },
}));
import { extract } from "../lib/extraction";
import { POST } from "../app/api/extract/route";
const request = (body: unknown) =>
  new Request("http://localhost/api/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  create.mockReset();
  vi.stubEnv("OPENAI_MODEL", "");
});
describe("public extraction adapter", () => {
  it("accepts anonymous extraction requests", async () => {
    create.mockResolvedValue({ output_text: JSON.stringify(sampleModel()) });
    const response = await POST(
      request({
        image: "data:image/jpeg;base64,AA==",
        page: 1,
        name: "drawing.jpg",
      }),
    );
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    const result = await response.json();
    expect(result.model.source.mode).toBe("ai");
    expect(
      result.model.items.every(
        (item: { review: string }) => item.review === "unreviewed",
      ),
    ).toBe(true);
  });
  it("defaults to GPT-6 Astra and allows a server override", async () => {
    create.mockResolvedValue({ output_text: JSON.stringify(sampleModel()) });
    await extract("x", 1, "test", new AbortController().signal);
    expect(create.mock.calls[0][0].model).toBe("gpt-6-astra");
    vi.stubEnv("OPENAI_MODEL", "custom-model");
    await extract("x", 1, "test", new AbortController().signal);
    expect(create.mock.calls[1][0].model).toBe("custom-model");
  });
  it("returns a configuration error when the server API key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(
      request({
        image: "data:image/jpeg;base64,AA==",
        page: 1,
        name: "drawing.jpg",
      }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("not configured");
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects actual body size including encoding", async () => {
    expect((await POST(request({ image: "x".repeat(3_800_001) }))).status).toBe(
      413,
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects malformed client input", async () =>
    expect(
      (await POST(request({ image: "not an image", page: 1, name: "x" })))
        .status,
    ).toBe(400));
  it("retries malformed output once and forces review", async () => {
    create
      .mockResolvedValueOnce({ output_text: "broken" })
      .mockResolvedValueOnce({ output_text: JSON.stringify(sampleModel()) });
    const m = await extract(
      "data:image/jpeg;base64,AA==",
      3,
      "drawing.jpg",
      new AbortController().signal,
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(m.source.mode).toBe("ai");
    expect(
      m.items.every((i) => i.page === 3 && i.review === "unreviewed"),
    ).toBe(true);
    expect(m.connections.every((e) => e.review === "unreviewed")).toBe(true);
  });
  it("never substitutes fixtures on repeated failure", async () => {
    create.mockResolvedValue({ output_text: "{}" });
    await expect(
      extract("x", 1, "test", new AbortController().signal),
    ).rejects.toThrow("after two attempts");
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("returns actionable rate-limit failure without retries", async () => {
    create.mockRejectedValue({ status: 429 });
    const r = await POST(
      request({ image: "data:image/jpeg;base64,AA==", page: 1, name: "x" }),
    );
    expect(r.status).toBe(429);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("returns an actionable gateway timeout when the provider times out", async () => {
    const error = new APIConnectionTimeoutError();
    create.mockRejectedValue(error);
    const r = await POST(
      request({ image: "data:image/jpeg;base64,AA==", page: 1, name: "x" }),
    );
    expect(r.status).toBe(504);
    expect((await r.json()).error).toContain("Try a clearer single-page crop");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
