import { Plant, PlantSchema, supportedTopology, validatePlant } from "./model";
import { escapeXml, symbol } from "./symbols";
export interface GeneratedTag {
  id: string;
  name: string;
  itemId: string;
  key: string;
  topic: string;
  direction: "command" | "telemetry";
  unit: string;
  provenance: "template" | "simulation-default";
}
export interface Gauge {
  id: string;
  type: string;
  name: string;
  label: string;
  hide: boolean;
  lock: boolean;
  property: {
    variableId?: string;
    events: unknown[];
    actions: unknown[];
    ranges: unknown[];
    [key: string]: unknown;
  };
}
export interface FuxaProject {
  version: string;
  name: string;
  server: Record<string, unknown>;
  devices: Record<
    string,
    {
      id: string;
      name: string;
      type: string;
      enabled: boolean;
      polling: number;
      property: Record<string, unknown>;
      tags: Record<string, unknown>;
    }
  >;
  hmi: {
    layout: Record<string, unknown>;
    views: {
      id: string;
      name: string;
      type: string;
      profile: Record<string, unknown>;
      items: Record<string, Gauge>;
      variables: Record<string, unknown>;
      svgcontent: string;
      property: { events: unknown[] };
    }[];
  };
  charts: unknown[];
  alarms: unknown[];
  scripts: unknown[];
}
export interface LayoutItem {
  id: string;
  x: number;
  y: number;
}
export function layout(m: Plant): LayoutItem[] {
  // Rank equipment by source x coordinate to retain general arrangement, then allocate collision-free slots.
  const eq = m.items
    .filter((i) => !["level", "flow"].includes(i.kind))
    .sort((a, b) => a.bbox.x - b.bbox.x || a.id.localeCompare(b.id));
  const positions = eq.map((i, n) => ({
    id: i.id,
    x: 120 + (n % 4) * 200,
    y: (i.kind === "tank" ? 230 : 310) + Math.floor(n / 4) * 210,
  }));
  const instruments = m.items
    .filter((i) => ["level", "flow"].includes(i.kind))
    .sort((a, b) => a.bbox.x - b.bbox.x || a.id.localeCompare(b.id));
  instruments.forEach((i, n) =>
    positions.push({ id: i.id, x: 120 + n * 300, y: 70 }),
  );
  return positions;
}
/** Keep measurement links beside instrument labels rather than through them. */
export function connectionPath(
  type: Plant["connections"][number]["type"],
  a: LayoutItem,
  b: LayoutItem,
): string {
  if (type === "process")
    return `M${a.x} ${a.y} H${(a.x + b.x) / 2} V${b.y} H${b.x}`;
  const direction = b.x >= a.x ? 1 : -1;
  const bend = a.x + direction * Math.max(70, Math.abs(b.x - a.x) / 2);
  return `M${a.x + direction * 25} ${a.y} H${bend} V${b.y} H${b.x}`;
}
export function tagsFor(m: Plant): GeneratedTag[] {
  const topology = supportedTopology(m),
    chain = topology.chain;
  return m.items
    .flatMap((i) => {
      let fields: [string, string, "command" | "telemetry", string][] = [];
      if (i.kind === "pump")
        fields = [
          ["pumpCommand", "Run command", "command", "bool"],
          ["pumpRunning", "Running", "telemetry", "bool"],
          ["pumpFault", "Fault", "telemetry", "bool"],
        ];
      if (i.kind === "control-valve")
        fields = [
          ["valveCommand", "Opening command", "command", "%"],
          ["valveFeedback", "Opening", "telemetry", "%"],
        ];
      if (i.kind === "level") {
        const target = m.connections.find(
          (e) => e.type === "measurement" && e.from === i.id,
        )?.to;
        fields = [
          [
            chain && target === chain[0] ? "sourceLevel" : "destinationLevel",
            "Level",
            "telemetry",
            "%",
          ],
        ];
      }
      if (i.kind === "flow") fields = [["flow", "Flow", "telemetry", "L/s"]];
      return fields.map(([key, label, direction, unit]) => ({
        id: `tag_${i.id}_${key}`,
        name: `${i.tag}.${label.replaceAll(" ", "_")}`,
        itemId: i.id,
        key,
        topic: `pnid/${direction}/${key}`,
        direction,
        unit,
        provenance: "simulation-default" as const,
      }));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
// Review metadata remains truthful; only technical integrity blocks an editable draft.
export function simulationReady(m: Plant) {
  const candidate: Plant = {
    ...m,
    items: m.items.map((i) => ({ ...i, review: "confirmed" })),
    connections: m.connections.map((e) => ({ ...e, review: "confirmed" })),
    assumptions: m.assumptions.map((a) => ({ ...a, status: "accepted" })),
  };
  return supportedTopology(candidate);
}
export function generateHmi(m: Plant) {
  return generate(m, true);
}
export function generate(m: Plant, direct = false) {
  PlantSchema.parse(m);
  const errors = direct ? [] : validatePlant(m);
  if (direct) {
    const ids = new Set<string>();
    for (const i of m.items) {
      if (ids.has(i.id)) errors.push(`Duplicate internal ID ${i.id}`);
      ids.add(i.id);
    }
    const edges = new Set<string>();
    for (const e of m.connections) {
      if (edges.has(e.id)) errors.push(`Duplicate connection ID ${e.id}`);
      edges.add(e.id);
      if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to)
        errors.push(`Invalid endpoints: ${e.id}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const topology = direct ? simulationReady(m) : supportedTopology(m);
  if (!direct && !topology.ok) throw new Error(topology.reason);
  const positions =
      direct && !topology.ok
        ? m.items.map((i) => ({
            id: i.id,
            x: 90 + (i.bbox.x + i.bbox.width / 2) * 780,
            y: 110 + (i.bbox.y + i.bbox.height / 2) * 440,
          }))
        : layout(m),
    tags = topology.ok
      ? tagsFor({
          ...m,
          items: m.items.map((i) => ({ ...i, review: "confirmed" })),
          connections: m.connections.map((e) => ({
            ...e,
            review: "confirmed",
          })),
          assumptions: m.assumptions.map((a) => ({ ...a, status: "accepted" })),
        })
      : [],
    items: Record<string, Gauge> = {},
    variables: Record<string, unknown> = {};
  const gauge = (id: string, type: string, variableId?: string): Gauge => ({
    id,
    type,
    name: id,
    label: type,
    hide: false,
    lock: false,
    property: { variableId, events: [], actions: [], ranges: [] },
  });
  const nodes: string[] = [];
  for (const e of m.connections) {
    const a = positions.find((p) => p.id === e.from)!,
      b = positions.find((p) => p.id === e.to)!;
    nodes.push(
      `<path d="${connectionPath(e.type, a, b)}" fill="none" stroke="${e.type === "process" ? "#6d858c" : "#8798a1"}" stroke-width="${e.type === "process" ? 5 : 2}" ${e.type === "process" ? "" : 'stroke-dasharray="6 5"'}/>`,
    );
  }
  for (const p of positions) {
    const i = m.items.find((i) => i.id === p.id)!;
    const id = `shape_${i.id}`,
      t =
        i.kind === "tank"
          ? tags.find(
              (t) =>
                t.itemId ===
                m.connections.find(
                  (e) =>
                    e.type === "measurement" &&
                    e.to === i.id &&
                    m.items.find((item) => item.id === e.from)?.kind ===
                      "level",
                )?.from,
            )
          : tags.find(
              (t) =>
                t.itemId === i.id &&
                t.direction === "telemetry" &&
                (i.kind !== "pump" || t.key === "pumpRunning"),
            );
    items[id] = gauge(id, "svg-ext-shapes", t?.id);
    if (i.kind === "pump")
      items[id].property.ranges = [
        { min: 0, max: 0, color: "#eef1f3", stroke: "#26323b" },
        { min: 1, max: 1, color: "#b7e1ca", stroke: "#26323b" },
      ];
    nodes.push(
      `<g id="${id}" type="svg-ext-shapes" transform="translate(${p.x} ${p.y})" fill="#edf3f5" stroke="#26323b" stroke-width="2">${symbol(i.kind)}</g><text x="${p.x}" y="${p.y + (i.kind === "tank" ? 92 : 58)}" text-anchor="middle" font-size="17" fill="#26323b">${escapeXml(i.tag || i.id)}</text>`,
    );
  }
  tags.forEach((t, n) => {
    variables[t.id] = { id: t.id, name: t.name, device: "d_mqtt" };
    if (t.direction === "telemetry") {
      const id = `value_${t.id}`;
      items[id] = gauge(id, "svg-ext-value", t.id);
      items[id].property.ranges = [
        { type: 1, text: t.unit, fractionDigits: 1 },
      ];
      nodes.push(
        `<text x="${50 + (n % 4) * 220}" y="${460 + Math.floor(n / 4) * 65}" fill="#5b6870" font-size="12">${escapeXml(t.name)}</text><g id="${id}" type="svg-ext-value"><text x="${50 + (n % 4) * 220}" y="${488 + Math.floor(n / 4) * 65}" font-size="22" fill="#26323b">0 ${escapeXml(t.unit)}</text></g>`,
      );
    }
  });
  // FUXA persists enum keys (click/onSetValue), not translation labels.
  // GaugeBaseComponent.getEvents and FuxaViewComponent.runEvents dispatch these keys.
  const buttons = [
    ["start", "Start pump", "pumpCommand", "1"],
    ["stop", "Stop pump", "pumpCommand", "0"],
    ["open", "Valve 100%", "valveCommand", "100"],
    ["half", "Valve 50%", "valveCommand", "50"],
    ["close", "Valve 0%", "valveCommand", "0"],
  ];
  (topology.ok ? buttons : []).forEach(([id, label, key, value], n) => {
    const gid = `command_${id}`,
      tag = tags.find((t) => t.key === key)!;
    items[gid] = gauge(gid, "svg-ext-shapes", tag.id);
    items[gid].property.events = [
      {
        type: "click",
        action: "onSetValue",
        actparam: value,
        actoptions: {},
      },
    ];
    nodes.push(
      `<g id="${gid}" type="svg-ext-shapes" cursor="pointer"><rect x="${30 + n * 174}" y="625" width="162" height="42" rx="5" fill="#e5edf5" stroke="#607785"/><text x="${111 + n * 174}" y="652" text-anchor="middle" fill="#26323b">${label}</text></g>`,
    );
  });
  const height = Math.max(710, ...positions.map((p) => p.y + 160));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}"><g id="layer_overview"><title>Overview</title><text x="30" y="35" font-size="20" fill="#26323b">${escapeXml(m.name)} — ${topology.ok ? "SIMULATED" : "HMI DRAFT"}</text>${nodes.join("")}</g></svg>`;
  // v1.2.9 runtime reads devices (not the separate server metadata) and its
  // connection-status callback requires the enabled internal device "0".
  const server = {
    id: "0",
    name: "FUXA",
    type: "FuxaServer",
    enabled: true,
    polling: 1000,
    property: {},
    tags: {},
  };
  const project: FuxaProject = {
    version: "1.01",
    name: m.name,
    server,
    devices: {
      "0": server,
      d_mqtt: {
        id: "d_mqtt",
        name: "Demo MQTT",
        type: "MQTTclient",
        enabled: true,
        polling: 250,
        property: { address: "mqtt://broker:1883", clientId: "pnid-fuxa" },
        tags: Object.fromEntries(
          tags.map((t) => [
            t.id,
            {
              id: t.id,
              name: t.name,
              type: "raw",
              address: t.topic,
              memaddress: "",
              value: "0",
              access: t.direction === "command" ? "rw" : "r",
              options: {},
              format: 1,
            },
          ]),
        ),
      },
    },
    hmi: {
      layout: {
        start: "view_overview",
        showdev: true,
        autoresize: true,
        hidenavigation: false,
        navigation: { mode: "over", type: "block", items: [] },
        header: {},
        zoom: "disabled",
      },
      views: [
        {
          id: "view_overview",
          name: topology.ok
            ? "Overview (simulated)"
            : "Overview (editable draft)",
          type: "svg",
          profile: {
            width: 960,
            height,
            bkcolor: "#ffffffff",
            margin: 10,
            align: "topCenter",
            gridType: "fixed",
          },
          items,
          variables,
          svgcontent: svg,
          property: { events: [] },
        },
      ],
    },
    charts: [],
    alarms: [],
    scripts: [],
  };
  const ids = new Set(tags.map((t) => t.id));
  for (const g of Object.values(items))
    if (g.property.variableId && !ids.has(g.property.variableId))
      throw new Error(`Missing binding ${g.id}`);
  return {
    project,
    tags,
    positions,
    svg,
    report: {
      schemaVersion: "1.0",
      errors: [],
      humanReviewed: !direct,
      simulationEnabled: topology.ok,
      simulationReason: topology.reason,
      findings: direct ? validatePlant(m) : [],
      assumptions: m.assumptions,
      issues: m.issues,
      source: m.source,
      compatibility: {
        version: "1.2.9",
        schema: "inspected upstream source and native editor export",
        runtimeVerified: !direct && topology.ok,
        verifiedOn: "2026-10-06",
        testedRuntime: "FUXA 1.2.9 / Node 22.15.0 / Docker Linux arm64",
      },
      simulation: "Demonstration only; no inferred engineering controls",
      summary: {
        items: m.items.length,
        connections: m.connections.length,
        tags: tags.length,
        widgets: Object.keys(items).length,
      },
    },
  };
}
