import { expect, it } from "vitest";
import { AgentService } from "../lib/computer-use/service";
import { sampleModel } from "../lib/fixtures";
const token = "test-token-with-at-least-24-characters";
const request = (path: string, method = "GET", body?: unknown, auth = token) =>
  new Request("http://localhost" + path, {
    method,
    headers: {
      authorization: `Bearer ${auth}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
it("rejects unauthenticated runs before launching the browser", async () => {
  let launches = 0;
  const service = new AgentService(token, async () => {
    launches++;
  });
  expect(
    (
      await service.handle(
        request("/runs", "POST", { plant: sampleModel() }, "wrong"),
      )
    ).status,
  ).toBe(401);
  expect(launches).toBe(0);
});
it("keeps a cancelled browser busy until cleanup finishes and exposes its final state", async () => {
  let finish!: () => void;
  const service = new AgentService(token, async (_plant, run, signal) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
      signal.addEventListener("abort", () => {
        run.message = "Cleaning up";
      });
    });
    run.status = "cancelled";
  });
  const started = await service.handle(
    request("/runs", "POST", { plant: sampleModel() }),
  );
  expect(started.status).toBe(202);
  const run = await started.json();
  expect(
    (await service.handle(request("/runs", "POST", { plant: sampleModel() })))
      .status,
  ).toBe(409);
  expect(
    (await service.handle(request(`/runs/${run.id}`, "DELETE"))).status,
  ).toBe(202);
  expect(
    (await service.handle(request("/runs", "POST", { plant: sampleModel() })))
      .status,
  ).toBe(409);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const stopped = await (
    await service.handle(request(`/runs/${run.id}`))
  ).json();
  expect(stopped.status).toBe("cancelled");
  expect(stopped.finishedAt).toBeTruthy();
});
it("rejects malformed and unsupported plant models", async () => {
  const service = new AgentService(token, async () => {});
  expect(
    (await service.handle(request("/runs", "POST", { plant: {} }))).status,
  ).toBe(400);
  expect(
    (
      await service.handle(
        request("/runs", "POST", { plant: sampleModel("ambiguous") }),
      )
    ).status,
  ).toBe(400);
  expect((await service.handle(request("/runs/nope"))).status).toBe(404);
});
