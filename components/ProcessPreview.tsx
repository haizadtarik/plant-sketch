"use client";
import { Plant } from "@/lib/model";
import { layout, tagsFor, connectionPath } from "@/lib/generate";
import { symbol } from "@/lib/symbols";
import { SimState, Command, telemetry } from "@/lib/simulation.mjs";
export function ProcessPreview({
  model,
  state,
  command,
}: {
  model: Plant;
  state: SimState;
  command: Command;
}) {
  const positions = layout(model),
    values = telemetry(state, command),
    tags = tagsFor(model);
  return (
    <svg
      viewBox="0 0 960 520"
      role="img"
      aria-label="Simulation preview of tank transfer"
      className="process-svg"
    >
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".6" fill="#dbe2e5" />
        </pattern>
      </defs>
      <rect width="960" height="520" fill="url(#grid)" />
      {model.connections.map((e) => {
        const a = positions.find((p) => p.id === e.from)!,
          b = positions.find((p) => p.id === e.to)!;
        return (
          <path
            key={e.id}
            d={connectionPath(e.type, a, b)}
            fill="none"
            stroke={
              e.type === "process"
                ? state.running
                  ? "#2e8876"
                  : "#9aaab0"
                : "#a5afb4"
            }
            strokeWidth={e.type === "process" ? 5 : 2}
            strokeDasharray={e.type === "process" ? undefined : "5 5"}
          />
        );
      })}
      {positions.map((p) => {
        const i = model.items.find((i) => i.id === p.id)!;
        const tankSource = model.connections.some(
          (e) => e.from === i.id && e.type === "process",
        );
        const level = tankSource ? values.sourceLevel : values.destinationLevel;
        const value =
          i.kind === "tank"
            ? `${level.toFixed(1)} %`
            : i.kind === "pump"
              ? state.fault
                ? "FAULT"
                : state.running
                  ? "RUNNING"
                  : "STOPPED"
              : i.kind === "control-valve"
                ? `${command.valve} %`
                : i.kind === "flow"
                  ? `${state.flow.toFixed(1)} L/s`
                  : `${values[tags.find((t) => t.itemId === i.id)!.key].toFixed(1)} %`;
        return (
          <g key={p.id}>
            <g
              transform={`translate(${p.x} ${p.y})`}
              fill={
                i.kind === "pump"
                  ? state.fault
                    ? "#f1c9c2"
                    : state.running
                      ? "#bbe4d4"
                      : "#eff2f4"
                  : "#edf3f5"
              }
              stroke="#465d68"
              strokeWidth="2"
              dangerouslySetInnerHTML={{ __html: symbol(i.kind) }}
            />
            {i.kind === "tank" && (
              <rect
                x={p.x - 40}
                y={p.y + 59 - level * 1.05}
                width="80"
                height={level * 1.05}
                rx="4"
                fill="#4a9aa5"
                opacity=".55"
              />
            )}
            <text
              x={p.x}
              y={p.y + (i.kind === "tank" ? 94 : 58)}
              textAnchor="middle"
              fill="#26323b"
              fontSize="16"
              fontWeight="600"
            >
              {i.tag}
            </text>
            <text
              x={p.x}
              y={p.y + (i.kind === "tank" ? 116 : 80)}
              textAnchor="middle"
              fill={state.fault && i.kind === "pump" ? "#a1382b" : "#52636d"}
              fontSize="15"
            >
              {value}
            </text>
          </g>
        );
      })}
      <text x="26" y="490" fill="#7a878f" fontSize="13">
        Demo parameters • 1000 L tanks • Maximum 20 L/s • Values are simulated
      </text>
    </svg>
  );
}
