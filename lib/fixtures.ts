import { Plant, Item } from "./model";
export function sampleModel(variant = "clear"): Plant {
  const specs: [string, string, Item["kind"], number, number][] = [
    ["t1", "TK-101", "tank", 0.12, 0.3],
    ["p1", "P-101", "pump", 0.38, 0.57],
    ["v1", "CV-101", "control-valve", 0.6, 0.57],
    ["t2", "TK-102", "tank", 0.8, 0.3],
    ["l1", "LT-101", "level", 0.12, 0.12],
    ["l2", "LT-102", "level", 0.8, 0.12],
    ["f1", "FT-101", "flow", 0.6, 0.32],
  ];
  const items = specs.map(([id, tag, kind, x, y]): Item => ({
    id,
    tag,
    kind,
    bbox: {
      x: variant === "alternate" ? 1 - x - 0.1 : x,
      y,
      width: kind === "tank" ? 0.12 : 0.08,
      height: kind === "tank" ? 0.23 : 0.1,
    },
    page: 1,
    unit: null,
    range: null,
    evidence: `Bundled fixture: ${tag} and visible symbol`,
    provenance: "extracted",
    review: "confirmed",
    description:
      kind === "tank" ? (id === "t1" ? "Source tank" : "Receiving tank") : kind,
  }));
  return {
    schemaVersion: "1.0",
    name:
      variant === "ambiguous"
        ? "Transfer with ambiguous crossing"
        : variant === "alternate"
          ? "Reverse arrangement (held out)"
          : "Tank transfer",
    source: { name: `${variant}.svg`, page: 1, mode: "sample" },
    items,
    connections: [
      ["c1", "t1", "p1", "process"],
      ["c2", "p1", "v1", "process"],
      ["c3", "v1", "t2", "process"],
      ["c4", "l1", "t1", "measurement"],
      ["c5", "l2", "t2", "measurement"],
      ["c6", "f1", "v1", "measurement"],
    ].map(([id, from, to, type]) => ({
      id,
      from,
      to,
      type: type as "process" | "measurement",
      direction: type === "process" ? "forward" : "unknown",
      evidence:
        "Visible continuous pipe or dashed measurement relationship in sample",
      review: "confirmed",
      provenance: "extracted",
    })),
    issues:
      variant === "ambiguous"
        ? [
            {
              id: "crossing",
              message:
                "Crossing at pump outlet has no junction dot. Confirm the branch or remove it; do not assume connectivity.",
              severity: "structural",
              status: "unresolved",
              itemId: "p1",
            },
          ]
        : [],
    assumptions: [
      {
        id: "demo",
        message:
          "Demo only: 1000 L per tank, maximum 20 L/s, linear valve response, no PID or alarm thresholds inferred.",
        status: "accepted",
        provenance: "simulation-default",
      },
    ],
  };
}
