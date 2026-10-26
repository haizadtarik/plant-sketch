import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/fuxa-agent/[[...path]]/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const context = { params: Promise.resolve({ path: ["runs"] }) };
it("keeps the proxy disabled until the worker is configured", async () => {
  vi.stubEnv("FUXA_AGENT_URL", "");
  const response = await GET(
    new Request("http://localhost/api/fuxa-agent/health"),
    context,
  );
  expect(response.status).toBe(503);
});
it("requires a browser-supplied token and rejects cross-origin requests", async () => {
  vi.stubEnv("FUXA_AGENT_URL", "http://127.0.0.1:1882");
  expect(
    (
      await POST(
        new Request("http://localhost/api/fuxa-agent/runs", { method: "POST" }),
        context,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await POST(
        new Request("http://localhost/api/fuxa-agent/runs", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            origin: "http://other.test",
          },
        }),
        context,
      )
    ).status,
  ).toBe(403);
});
it("forwards only the configured worker route and preserves its error status", async () => {
  vi.stubEnv("FUXA_AGENT_URL", "http://127.0.0.1:1882");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    expect(String(url)).toBe("http://127.0.0.1:1882/runs");
    expect(options?.headers).toMatchObject({
      authorization: "Bearer supplied-token",
    });
    expect(options?.body).toBe('{"plant":{}}');
    expect(options?.redirect).toBe("error");
    return Response.json({ error: "Invalid plant." }, { status: 400 });
  });
  const response = await POST(
    new Request("http://localhost/api/fuxa-agent/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer supplied-token",
        origin: "http://localhost",
      },
      body: '{"plant":{}}',
    }),
    context,
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid plant." });
});
