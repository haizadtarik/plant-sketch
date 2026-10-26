"use client";
/* Drawing images are local data URLs; bypassing Next image optimization avoids server processing. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Upload,
  FileImage,
  FlaskConical,
  Download,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  Square,
  ShieldCheck,
  Layers,
  X,
  CircleHelp,
  FolderOpen,
  Check,
  AlertTriangle,
} from "lucide-react";
import { Plant, PlantSchema } from "@/lib/model";
import { sampleModel } from "@/lib/fixtures";
import { Drawing, renderFile, REQUEST_BUDGET } from "@/lib/upload";
import { generateHmi as generate } from "@/lib/generate";
import { initialState, step, SimState, Command } from "@/lib/simulation.mjs";
import { bundle, tagCsv } from "@/lib/export";
import { DrawingSchema, WorkspaceSchema } from "@/lib/workspace";
import { ProcessPreview } from "./ProcessPreview";
import { FuxaAutomation } from "./FuxaAutomation";
const stages = ["Upload", "HMI", "Simulate", "Export"];
const saveFile = (name: string, body: BlobPart, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const stringify = (v: unknown) => JSON.stringify(v, null, 2);
export function Studio() {
  const [stage, setStage] = useState(0),
    [model, setModel] = useState<Plant | null>(null),
    [drawing, setDrawing] = useState<Drawing | null>(null),
    [generated, setGenerated] = useState<ReturnType<typeof generate> | null>(
      null,
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pdfFile, setPdfFile] = useState<File | null>(null),
    [state, setState] = useState<SimState>(initialState()),
    [command, setCommand] = useState<Command>({
      pump: false,
      valve: 50,
      fault: false,
    }),
    [paused, setPaused] = useState(true),
    [initial, setInitial] = useState({ source: 800, destination: 200 }),
    [help, setHelp] = useState(false),
    [storageReady, setStorageReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    abortRef = useRef<AbortController | null>(null),
    operation = useRef(0),
    busyRef = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem("pnid-workspace-v1");
        if (saved) {
          const w = WorkspaceSchema.parse(JSON.parse(saved));
          const m = w.model ? PlantSchema.parse(w.model) : null;
          setModel(m);
          setDrawing(w.drawing);
          if (m) {
            setGenerated(generate(m));
            setStage(1);
            setNotice("Restored workspace and recreated the FUXA HMI.");
          }
        }
      } catch {
        setNotice(
          "Saved workspace could not be restored. Import a backup or load a sample.",
        );
      }
      setStorageReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(
        "pnid-workspace-v1",
        JSON.stringify({ model, drawing }),
      );
    } catch {
      queueMicrotask(() =>
        setNotice(
          "Browser storage is full or unavailable. Download a workspace backup now.",
        ),
      );
    }
  }, [model, drawing, storageReady]);
  useEffect(() => {
    if (paused || !generated) return;
    const timer = setInterval(
      () => setState((s) => step(s, command, 0.25)),
      250,
    );
    return () => clearInterval(timer);
  }, [paused, command, generated]);
  useEffect(
    () => () => {
      operation.current++;
      abortRef.current?.abort();
    },
    [],
  );
  const change = (m: Plant) => {
    setModel(m);
    setGenerated(null);
    setPaused(true);
    setCommand({ pump: false, valve: 50, fault: false });
  };
  const begin = () => {
    if (busyRef.current) return null;
    busyRef.current = true;
    return ++operation.current;
  };
  const finish = (id: number) => {
    if (id === operation.current) {
      setBusy("");
      busyRef.current = false;
    }
  };
  const cancel = () => {
    operation.current++;
    abortRef.current?.abort();
    setBusy("");
    busyRef.current = false;
    setError("Extraction cancelled. Your selected drawing is retained.");
  };
  async function upload(file: File, page = 1) {
    const id = begin();
    if (id === null) return;
    setError("");
    setBusy("Preparing drawing…");
    try {
      const d = await renderFile(file, page);
      if (id !== operation.current) return;
      setDrawing(d);
      setModel(null);
      setGenerated(null);
      setPaused(true);
      setPdfFile(file.type === "application/pdf" ? file : null);
      setStage(0);
    } catch (e) {
      if (id === operation.current)
        setError(e instanceof Error ? e.message : "Unable to read file.");
    } finally {
      finish(id);
    }
  }
  function sample(id = "clear") {
    setError("");
    setNotice("Sample fixture loaded. No AI call was made.");
    const m = sampleModel(id);
    setDrawing({
      image: `/fixtures/${id}.svg`,
      name: `${id} sample P&ID`,
      page: 1,
      pages: 1,
      width: 1000,
      height: 700,
    });
    createHmi(m);
    setPdfFile(null);
  }
  async function extraction() {
    if (!drawing) return;
    const id = begin();
    if (id === null) return;
    setError("");
    setBusy("AI creating FUXA HMI…");
    const c = new AbortController();
    abortRef.current = c;
    const timer = setTimeout(() => c.abort(), 100_000);
    try {
      const body = JSON.stringify({
        image: drawing.image,
        page: drawing.page,
        name: drawing.name,
      });
      if (new TextEncoder().encode(body).length > REQUEST_BUDGET)
        throw new Error(
          "Drawing exceeds request budget. Re-upload a cropped process page.",
        );
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        signal: c.signal,
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Extraction failed");
      const m = PlantSchema.parse(result.model);
      if (id !== operation.current) return;
      createHmi(m);
    } catch (e) {
      if (id === operation.current)
        setError(
          c.signal.aborted
            ? "Extraction cancelled or timed out. Try a clearer crop."
            : e instanceof Error
              ? e.message
              : "Extraction failed.",
        );
    } finally {
      clearTimeout(timer);
      finish(id);
    }
  }
  function createHmi(m: Plant) {
    const g = generate(m);
    change(m);
    setGenerated(g);
    setState(initialState(initial.source, initial.destination));
    setStage(1);
    setNotice(
      "FUXA HMI created. Open project.json in the FUXA editor and correct any mistakes there.",
    );
  }
  async function downloadBundle() {
    if (!model) return;
    const id = begin();
    if (id === null) return;
    setBusy("Packaging runtime…");
    setError("");
    try {
      const r = await fetch("/runtime/simulation.mjs");
      if (!r.ok)
        throw new Error("Simulation core could not be loaded; retry download.");
      const z = await bundle(model, await r.text());
      const data = await z.generateAsync({ type: "blob" });
      saveFile("plantsketch-runtime.zip", data, "application/zip");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      finish(id);
    }
  }
  async function importWorkspace(file: File) {
    setError("");
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("Backup exceeds 25 MB.");
      const w = JSON.parse(await file.text());
      const m = PlantSchema.parse(w.model || w);
      createHmi({ ...m, source: { ...m.source, mode: "import" } });
      const parsedDrawing = DrawingSchema.safeParse(w.drawing);
      setDrawing(parsedDrawing.success ? parsedDrawing.data : null);
      setPdfFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid backup.");
    }
  }
  return (
    <div className="studio">
      <header className="app-header">
        <Link className="brand" href="/" aria-label="PlantSKetch home">
          <span className="brand-mark">
            <Layers size={23} />
          </span>
          <strong>
            Plant<span>SKetch</span>
          </strong>
          <span className="mvp">MVP</span>
        </Link>
        <div className="header-actions">
          <span className="local-indicator">
            <span />
            Local workspace
          </span>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => importInput.current?.click()}
          >
            <FolderOpen size={16} />
            Import backup
          </button>
          {model && (
            <button
              className="text-button"
              onClick={() =>
                saveFile(
                  "plantsketch-workspace.json",
                  stringify({ model, drawing }),
                )
              }
            >
              <Download size={16} />
              Backup
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Help and limitations"
            onClick={() => setHelp(!help)}
          >
            <CircleHelp size={19} />
          </button>
          <input
            ref={importInput}
            hidden
            type="file"
            accept="application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importWorkspace(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>
      <nav className="workflow" aria-label="Workflow">
        {stages.map((s, n) => (
          <button
            key={s}
            className={`step ${n === stage ? "active" : ""} ${n < stage ? "complete" : ""}`}
            aria-label={s}
            aria-current={n === stage ? "step" : undefined}
            disabled={
              !!busy ||
              (n > 0 && !generated) ||
              (n === 2 && !generated?.report.simulationEnabled)
            }
            onClick={() => setStage(n)}
          >
            <span className="step-number">
              {n < stage ? <Check size={14} /> : n + 1}
            </span>
            {s}
            {n < stages.length - 1 && (
              <ChevronRight size={16} className="step-arrow" />
            )}
          </button>
        ))}
        <span className="workflow-note">Upload a drawing. Edit in FUXA.</span>
      </nav>
      <main>
        <div className="workspace-title">
          <div>
            <p className="overline">
              {stage === 0
                ? "New workspace"
                : model?.source.mode === "sample"
                  ? "Sample fixture"
                  : model?.source.mode === "ai"
                    ? "AI extraction"
                    : "HMI workspace"}
            </p>
            <h1>
              {stage === 0
                ? "From drawing to a working overview"
                : stage === 1
                  ? "Overview generated"
                  : stage === 2
                    ? "Simulation preview"
                    : "Export your project"}
            </h1>
            <p>
              {stage === 0
                ? "Upload a P&ID page or explore the tank-transfer sample."
                : stage === 1
                  ? "Your editable FUXA HMI is ready. Correct any mistakes in the FUXA editor."
                  : stage === 2
                    ? "Explore a simplified tank transfer. All behavior and values are simulated."
                    : "Download your editable FUXA project and runtime."}
            </p>
          </div>
          {model && stage > 0 && (
            <span className="project-name">
              <FileImage size={16} />
              {model.name}
            </span>
          )}
        </div>
        {error && (
          <div className="alert error" role="alert">
            <AlertTriangle size={18} />
            <span style={{ whiteSpace: "pre-line" }}>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert info" role="status">
            <ShieldCheck size={17} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {help && (
          <aside className="help-panel">
            <h2>Scope & conventions</h2>
            <p>
              One page, simple ISA-style open-circle LT/FT instruments, vessel
              tanks, centrifugal pump and bow-tie control valve. Dashed lines
              indicate measurement relationships. Crossing pipes need junction
              evidence.
            </p>
            <p>
              The simulator supports one directed tank → pump → valve → tank
              topology with two level instruments and one flow instrument.
              Uncertain detections can be corrected in FUXA. Ranges, alarms and
              control behavior are never inferred from plausible tags.
            </p>
            <p>
              Browser storage is local to this browser. Download a backup for
              portability. The SVG simulation preview is separate from the
              actual FUXA runtime. The supported demo template was tested in
              FUXA 1.2.9 with Docker.
            </p>
          </aside>
        )}
        {stage === 0 && (
          <div className="upload-layout">
            <section className="panel upload-panel">
              <div className="panel-heading">
                <h2>Source drawing</h2>
                <span className="caption">PDF, PNG or JPEG</span>
              </div>
              <div
                className={`dropzone ${drawing ? "has-drawing" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void upload(f);
                }}
              >
                {drawing ? (
                  <div className="drawing-upload">
                    <img
                      src={drawing.image}
                      alt="Selected P&ID page before extraction"
                    />
                    <div className="drawing-caption">
                      <span>{drawing.name}</span>
                      <span>
                        {drawing.width} × {drawing.height} px
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="upload-icon">
                      <Upload size={30} />
                    </span>
                    <h3>Drop your P&ID here</h3>
                    <p>Choose one clear page with 5–15 items.</p>
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() => fileInput.current?.click()}
                    >
                      Choose drawing
                    </button>
                    <p className="caption">
                      Up to 20 MB · Minimum 700 × 400 px
                    </p>
                  </>
                )}
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
              </div>
              {drawing && (
                <div className="upload-options">
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    Replace drawing
                  </button>
                  {pdfFile && (
                    <label>
                      PDF page
                      <select
                        value={drawing.page}
                        disabled={!!busy}
                        onChange={(e) =>
                          void upload(pdfFile, Number(e.target.value))
                        }
                      >
                        {Array.from({ length: drawing.pages }, (_, n) => (
                          <option key={n} value={n + 1}>
                            Page {n + 1} of {drawing.pages}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
              <div className="extraction-bar">
                <div>
                  <h3>Create FUXA HMI</h3>
                  <p>
                    Create an editable HMI from the selected P&ID page. Make
                    corrections directly in FUXA.
                  </p>
                </div>
                {busy ? (
                  <>
                    <span className="busy" role="status">
                      {busy}
                    </span>
                    {busy.includes("AI") && (
                      <button className="button secondary" onClick={cancel}>
                        Cancel
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="button"
                    disabled={
                      !drawing || drawing.image.startsWith("/fixtures/")
                    }
                    onClick={() => void extraction()}
                  >
                    Create HMI
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
              <p className="caption">
                Drawing requests stay below 3.8 MB including encoding.
                Extraction can take up to 100 seconds; cancel at any time.
              </p>
            </section>
            <aside className="sample-panel panel">
              <div className="sample-icon">
                <FlaskConical size={25} />
              </div>
              <h2>Start with a known process</h2>
              <p>
                Two tanks, a pump and a control valve. Follow the entire
                workflow without API credentials.
              </p>
              <img
                className="sample-thumb"
                src="/fixtures/clear.svg"
                alt="Tank-transfer sample drawing"
              />
              <button
                className="button secondary full"
                disabled={!!busy}
                onClick={() => sample()}
              >
                Try sample P&ID
                <ChevronRight size={16} />
              </button>
              <div className="sample-facts">
                <span>7 equipment & instrument items</span>
                <span>6 process & measurement connections</span>
                <span>Clearly labelled sample detections</span>
              </div>
              <details>
                <summary>More sample drawings</summary>
                <button
                  className="text-button"
                  onClick={() => sample("ambiguous")}
                >
                  Ambiguous crossing
                </button>
                <button
                  className="text-button"
                  onClick={() => sample("alternate")}
                >
                  Reverse arrangement (held out)
                </button>
              </details>
            </aside>
          </div>
        )}
        {(stage === 1 || stage === 2) && model && generated && (
          <>
            <div className="generation-layout">
              <section className="panel hmi-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {generated.report.simulationEnabled
                        ? "Simulation preview"
                        : "HMI preview"}
                    </h2>
                    <p>
                      {model.name} ·{" "}
                      {generated.report.simulationEnabled
                        ? "All values simulated"
                        : "Editable draft"}
                    </p>
                  </div>
                  <span className={`badge ${state.running ? "green" : ""}`}>
                    {!generated.report.simulationEnabled
                      ? "Edit in FUXA"
                      : state.fault
                        ? "Pump fault"
                        : state.running
                          ? "Pump running"
                          : "Pump stopped"}
                  </span>
                </div>
                {generated.report.simulationEnabled ? (
                  <ProcessPreview
                    model={model}
                    state={state}
                    command={command}
                  />
                ) : (
                  <img
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(generated.svg)}`}
                    alt="Generated FUXA HMI draft"
                  />
                )}
                <div className="hmi-footer">
                  <span className="caption">
                    SVG browser preview · Separate from FUXA runtime
                  </span>
                  <span className="caption">
                    Elapsed {state.elapsed.toFixed(1)} s
                  </span>
                </div>
              </section>
              <aside className="panel simulation-controls">
                {stage === 1 ? (
                  <>
                    <h2>Generation summary</h2>
                    <div className="summary-counts">
                      <div>
                        <strong>{generated.report.summary.items}</strong>
                        <span>detected items</span>
                      </div>
                      <div>
                        <strong>{generated.tags.length}</strong>
                        <span>bound tags</span>
                      </div>
                    </div>
                    <p>
                      Symbols and connections are editable in FUXA. Use the
                      source drawing to correct labels, equipment and layout.
                    </p>
                    <div className="validation success">
                      <CheckCircle />
                      Editable FUXA widgets created
                    </div>
                    <h3>Demo assumptions</h3>
                    {model.assumptions.map((a) => (
                      <p key={a.id} className="assumption">
                        {a.message}
                        <small>{a.status}</small>
                      </p>
                    ))}
                    {model.issues
                      .filter((i) => i.status !== "resolved")
                      .map((i) => (
                        <p key={i.id} className="issue">
                          {i.message} ({i.status})
                        </p>
                      ))}
                    <p className="caption">
                      FUXA v1.2.9: demo import, editing, live values and
                      commands verified in Docker.
                    </p>
                    <button
                      className="button full"
                      onClick={() =>
                        saveFile("project.json", stringify(generated.project))
                      }
                    >
                      Download FUXA project
                      <Download size={16} />
                    </button>
                    <a
                      className="button secondary full"
                      href={
                        process.env.NEXT_PUBLIC_FUXA_URL ||
                        "http://localhost:1881/editor"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open FUXA editor
                    </a>
                    <p>
                      In FUXA, Open project → project.json, then edit the
                      shapes, tags and connections and Save.
                    </p>
                    <button
                      className="button full"
                      disabled={!generated.report.simulationEnabled}
                      onClick={() => setStage(2)}
                    >
                      Open simulation
                      <Play size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="section-heading">
                      <h2>Demo controls</h2>
                      <FlaskConical size={20} />
                    </div>
                    <p>Commands and feedback use separate tags.</p>
                    <label className="control-label">Pump command</label>
                    <div className="segmented">
                      <button
                        aria-pressed={command.pump}
                        className={command.pump ? "selected" : ""}
                        onClick={() =>
                          setCommand((c) => ({ ...c, pump: true }))
                        }
                      >
                        <Play size={15} />
                        Start pump
                      </button>
                      <button
                        aria-pressed={!command.pump}
                        className={!command.pump ? "selected" : ""}
                        onClick={() =>
                          setCommand((c) => ({ ...c, pump: false }))
                        }
                      >
                        <Square size={14} />
                        Stop
                      </button>
                    </div>
                    <label className="range-label">
                      Valve opening<span>{command.valve}%</span>
                      <input
                        aria-label="Valve opening"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={command.valve}
                        onChange={(e) =>
                          setCommand((c) => ({
                            ...c,
                            valve: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <div className="readouts">
                      <div>
                        <span>Flow</span>
                        <strong data-testid="flow-value">
                          {state.flow.toFixed(1)} <small>L/s</small>
                        </strong>
                      </div>
                      <div>
                        <span>Source tank</span>
                        <strong data-testid="source-level">
                          {(state.source / 10).toFixed(1)} <small>%</small>
                        </strong>
                      </div>
                      <div>
                        <span>Receiving tank</span>
                        <strong>
                          {(state.destination / 10).toFixed(1)} <small>%</small>
                        </strong>
                      </div>
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={command.fault}
                        onChange={(e) =>
                          setCommand((c) => ({ ...c, fault: e.target.checked }))
                        }
                      />
                      Inject simulated pump fault
                    </label>
                    <div className="simulation-buttons">
                      <button
                        className="button secondary"
                        onClick={() => setPaused(!paused)}
                      >
                        {paused ? <Play size={16} /> : <Pause size={16} />}
                        {paused ? "Resume simulation" : "Pause simulation"}
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Reset simulation"
                        onClick={() => {
                          setState(
                            initialState(initial.source, initial.destination),
                          );
                          setCommand({ pump: false, valve: 50, fault: false });
                          setPaused(true);
                        }}
                      >
                        <RotateCcw size={18} />
                      </button>
                    </div>
                    <details>
                      <summary>Initial conditions (demo litres)</summary>
                      <div className="item-row">
                        <label>
                          Source volume
                          <input
                            type="number"
                            min="0"
                            max="1000"
                            value={initial.source}
                            onChange={(e) =>
                              setInitial((v) => ({
                                ...v,
                                source: Math.min(
                                  1000,
                                  Math.max(0, Number(e.target.value)),
                                ),
                              }))
                            }
                          />
                        </label>
                        <label>
                          Receiving volume
                          <input
                            type="number"
                            min="0"
                            max="1000"
                            value={initial.destination}
                            onChange={(e) =>
                              setInitial((v) => ({
                                ...v,
                                destination: Math.min(
                                  1000,
                                  Math.max(0, Number(e.target.value)),
                                ),
                              }))
                            }
                          />
                        </label>
                      </div>
                      <p className="caption">
                        Reset applies these conditions. Runtime bundle starts at
                        800 / 200 L.
                      </p>
                    </details>
                    <div className="validation info">
                      {state.source <= 0
                        ? "Source empty: transfer stopped."
                        : state.destination >= 1000
                          ? "Receiving tank full: transfer stopped."
                          : paused
                            ? "Simulation paused. Commands apply when resumed."
                            : "Demo transfer simulation is active."}
                    </div>
                  </>
                )}
              </aside>
            </div>
            <div className="stage-footer">
              <button
                className="text-button"
                onClick={() => {
                  setStage(0);
                  setPaused(true);
                }}
              >
                Upload another drawing
              </button>
              <button className="button" onClick={() => setStage(3)}>
                Continue to export
                <ChevronRight size={16} />
              </button>
            </div>
          </>
        )}
        {stage === 3 && model && generated && (
          <div className="export-layout">
            <section className="panel export-panel">
              <h2>Project artifacts</h2>
              <p>
                Generated directly from the P&ID. Backups preserve your
                workspace separately.
              </p>
              {[
                [
                  "FUXA project JSON",
                  "Native SVG shapes, numeric gauges and MQTT bindings",
                  "project.json",
                  generated.project,
                ],
                [
                  "Extracted plant model",
                  "Versioned source evidence, corrections and relationships",
                  "plant-model.json",
                  model,
                ],
                [
                  "Validation & assumptions",
                  "Detection issues and compatibility limitations",
                  "report.json",
                  generated.report,
                ],
              ].map(([title, description, name, data]) => (
                <div key={name as string} className="export-row">
                  <div>
                    <h3>{title as string}</h3>
                    <p>{description as string}</p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => saveFile(name as string, stringify(data))}
                  >
                    <Download size={16} />
                    Download
                  </button>
                </div>
              ))}
              <div className="export-row">
                <div>
                  <h3>Tag list CSV</h3>
                  <p>
                    {generated.tags.length} tags with separate command and
                    telemetry topics
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() =>
                    saveFile("tags.csv", tagCsv(generated.tags), "text/csv")
                  }
                >
                  <Download size={16} />
                  Download
                </button>
              </div>
            </section>
            <aside className="panel runtime-panel">
              <span className="sample-icon">
                <Layers size={25} />
              </span>
              <h2>Run in actual FUXA</h2>
              <p>
                Download a separate Docker runtime bundle containing FUXA v1.2.9
                setup, MQTT broker, Node simulator and project artifacts.
              </p>
              <div className="validation success">
                <strong>FUXA 1.2.9 runtime tested</strong>
                <p>
                  The supported demo template passed live import, editing,
                  telemetry, pump/valve commands and restart checks in Docker on
                  6 October 2026.
                </p>
              </div>
              <ol>
                <li>Unzip the runtime bundle.</li>
                <li>
                  Run <code>docker compose up --build -d</code>.
                </li>
                <li>
                  Open <code>localhost:1881</code>.
                </li>
                <li>
                  In FUXA editor, Open project → <code>project.json</code>, then
                  Save.
                </li>
              </ol>
              <button
                className="button full"
                disabled={!!busy}
                onClick={() => void downloadBundle()}
              >
                <Download size={17} />
                {busy || "Download runtime ZIP"}
              </button>
              <p className="caption">
                Browser preview works independently. This bundle runs outside
                Vercel.
              </p>
            </aside>
          </div>
        )}
        {model && generated?.report.simulationEnabled && (
          <div hidden={stage !== 3}>
            <FuxaAutomation key={JSON.stringify(model)} plant={model} />
          </div>
        )}
      </main>
      <footer className="app-footer">
        <span>PlantSKetch · Tank-transfer MVP</span>
        <span>Local browser storage · Export a backup to keep your work</span>
      </footer>
    </div>
  );
}
function CheckCircle() {
  return <Check size={16} />;
}
