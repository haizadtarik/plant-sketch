import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { PlantSchema, type Plant } from "../model";
import { simulationReady } from "../generate";
import { limitedBody } from "./http";
import type { AgentRun } from "./types";

export class AgentService {
  private runs = new Map<string, AgentRun>();
  private active?: {
    id: string;
    controller: AbortController;
    completion: Promise<void>;
  };
  constructor(
    private token: string,
    private execute: (
      plant: Plant,
      run: AgentRun,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {
    if (token.length < 24)
      throw new Error("FUXA_AGENT_TOKEN must contain at least 24 characters.");
  }
  async shutdown() {
    this.active?.controller.abort(new Error("Worker shutting down."));
    await this.active?.completion;
  }
  async handle(request: Request): Promise<Response> {
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    if (
      !timingSafeEqual(
        digest(request.headers.get("authorization") || ""),
        digest(`Bearer ${this.token}`),
      )
    )
      return Response.json(
        { error: "Invalid worker access token." },
        { status: 401 },
      );
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return Response.json({ ready: true, activeRunId: this.active?.id });
    const id = /^\/runs\/([\w-]+)$/.exec(path)?.[1];
    if (id) {
      const run = this.runs.get(id);
      if (!run)
        return Response.json(
          { error: "Run not found or expired." },
          { status: 404 },
        );
      if (request.method === "DELETE") {
        if (this.active?.id === id) {
          run.status = "stopping";
          run.message =
            "Stopping the run and confirming the demo pump is stopped…";
          this.active.controller.abort(new Error("Cancelled by user."));
        }
        return Response.json(run, { status: 202 });
      }
      if (request.method === "GET") return Response.json(run);
    }
    if (path !== "/runs" || request.method !== "POST")
      return Response.json({ error: "Route not found." }, { status: 404 });
    const existing = this.active;
    if (existing)
      return Response.json(
        { error: "A FUXA run is already active.", activeRunId: existing.id },
        { status: 409 },
      );
    let plant: Plant;
    try {
      plant = PlantSchema.parse(JSON.parse(await limitedBody(request)).plant);
      const topology = simulationReady(plant);
      if (!topology.ok) throw new Error(topology.reason);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Invalid plant model.",
        },
        { status: 400 },
      );
    }
    // The body was awaited: another request may have claimed the worker meanwhile.
    if (this.active)
      return Response.json(
        { error: "A FUXA run is already active.", activeRunId: this.active.id },
        { status: 409 },
      );
    for (const [key, run] of this.runs)
      if (run.finishedAt && Date.parse(run.finishedAt) < Date.now() - 3_600_000)
        this.runs.delete(key);
    while (this.runs.size >= 20)
      this.runs.delete(this.runs.keys().next().value!);
    const run: AgentRun = {
      id: randomUUID(),
      status: "running",
      phase: "Starting browser",
      message: "Starting isolated FUXA browser…",
      startedAt: new Date().toISOString(),
      checks: [],
      events: [],
    };
    this.runs.set(run.id, run);
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(new Error("Run exceeded the 10-minute time limit.")),
      600_000,
    );
    const active = { id: run.id, controller, completion: Promise.resolve() };
    this.active = active;
    active.completion = this.execute(plant, run, controller.signal)
      .catch((error) => {
        run.status = controller.signal.aborted ? "cancelled" : "failed";
        run.message = error instanceof Error ? error.message : "Worker failed.";
      })
      .finally(() => {
        clearTimeout(timer);
        run.finishedAt ??= new Date().toISOString();
        if (run.status === "running" || run.status === "stopping") {
          run.status = controller.signal.aborted ? "cancelled" : "failed";
          run.message = controller.signal.aborted
            ? "Run cancelled."
            : "Worker ended without verified results.";
        }
        if (this.active === active) this.active = undefined;
      });
    return Response.json(run, { status: 202 });
  }
}
