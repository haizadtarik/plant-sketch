"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { Plant } from "@/lib/model";
import type { AgentRun } from "@/lib/computer-use/types";

const active = (run: AgentRun | null) =>
  run?.status === "running" || run?.status === "stopping";
export function FuxaAutomation({ plant }: { plant: Plant }) {
  const [token, setToken] = useState("");
  const [run, setRun] = useState<AgentRun | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef({ token: "", run: null as AgentRun | null });
  useEffect(() => {
    current.current = { token, run };
  }, [token, run]);
  useEffect(() => {
    const cancel = () => {
      const { token, run } = current.current;
      if (active(run))
        void fetch(`/api/fuxa-agent/runs/${run!.id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
          keepalive: true,
        }).catch(() => {});
    };
    window.addEventListener("beforeunload", cancel);
    return () => {
      window.removeEventListener("beforeunload", cancel);
      cancel();
    };
  }, []);
  async function call(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`/api/fuxa-agent/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Worker request failed.");
    return result;
  }
  const running = active(run);
  useEffect(() => {
    if (!running || !run?.id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/fuxa-agent/runs/${run.id}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Worker connection interrupted.");
        if (!disposed) {
          setRun(result);
          setError("");
        }
      } catch (e) {
        if (!disposed)
          setError(
            `${e instanceof Error ? e.message : "Connection interrupted."} The worker may still be running; retry Stop or reconnect.`,
          );
      }
      if (!disposed) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 800);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [running, run?.id, token]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const health = await call("health");
      setRun(
        health.activeRunId
          ? await call(`runs/${health.activeRunId}`)
          : await call("runs", "POST", { plant }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start run.");
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      setRun(await call(`runs/${run.id}`, "DELETE"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to stop run.");
    } finally {
      setBusy(false);
    }
  }
  function downloadEvidence() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuxa-run-${run!.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="panel fuxa-automation"
      aria-labelledby="fuxa-agent-title"
    >
      <div>
        <span className="eyebrow">OpenAI computer use</span>
        <h2 id="fuxa-agent-title">Set up and test your FUXA demo</h2>
        <p>
          The agent imports this project, checks MQTT, saves it, and tests pump
          and valve controls in a dedicated FUXA browser. Watch its progress
          below.
        </p>
        <p className="caption">
          Start the downloaded Docker runtime and local worker first. This run
          replaces the project in your dedicated demo instance and sends its
          screenshots to OpenAI. API usage applies.
        </p>
        <label className="agent-token">
          Worker access token
          <input
            type="password"
            autoComplete="off"
            value={token}
            maxLength={512}
            disabled={running || busy}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Token configured on your local worker"
          />
        </label>
        <div className="agent-actions">
          <button
            className="button"
            disabled={!token || running || busy}
            onClick={() => void start()}
          >
            {busy && !running ? "Connecting…" : "Set up and test in FUXA"}
          </button>
          {running && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void stop()}
            >
              Stop agent
            </button>
          )}
          {run && !running && (
            <button className="button secondary" onClick={downloadEvidence}>
              Download run evidence
            </button>
          )}
        </div>
        <details className="agent-setup">
          <summary>Local worker setup</summary>
          <p>
            Set <code>OPENAI_API_KEY</code>, <code>FUXA_AGENT_TOKEN</code> (at
            least 24 characters), and{" "}
            <code>FUXA_AGENT_URL=http://127.0.0.1:1882</code> in your local
            environment. Install Chromium with{" "}
            <code>npx playwright install chromium</code>, then run{" "}
            <code>npm run fuxa:agent</code> in a separate terminal. Restart this
            app after changing its environment.
          </p>
          <p>
            Use the same token here. It stays in memory. Runs stop after ten
            minutes. Reloading attempts cancellation; reconnecting recovers any
            active run.
          </p>
        </details>
        {error && (
          <p role="alert" className="validation error">
            {error}
          </p>
        )}
        {run && (
          <div aria-live="polite" className="agent-progress">
            <strong>
              {run.status === "passed"
                ? "Verified in FUXA"
                : run.status === "needs-attention"
                  ? "Needs your attention"
                  : run.phase}
            </strong>
            <p>{run.message}</p>
            <span className="caption">
              Status: {run.status} · {run.checks.length} checks passed
            </span>
            {!!run.checks.length && (
              <ul>
                {run.checks.map((check) => (
                  <li key={check.name}>{check.name}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {run?.screenshot && (
        <div className="agent-screen">
          <img src={run.screenshot} alt="Latest FUXA computer-use screenshot" />
          <p className="caption">
            Latest observation from the isolated browser
          </p>
        </div>
      )}
    </section>
  );
}
