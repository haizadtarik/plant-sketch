import { z } from "zod";
export const kinds = [
  "tank",
  "pump",
  "control-valve",
  "level",
  "flow",
  "unsupported",
] as const;
export const ItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
  tag: z.string().max(80),
  kind: z.enum(kinds),
  bbox: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  }),
  page: z.number().int().positive(),
  unit: z.string().nullable(),
  range: z.object({ min: z.number(), max: z.number() }).nullable(),
  evidence: z.string().max(1000),
  provenance: z.enum(["extracted", "template", "user", "simulation-default"]),
  review: z.enum(["unreviewed", "confirmed"]),
  description: z.string().max(500),
});
export const PlantSchema = z.object({
  schemaVersion: z.literal("1.0"),
  name: z.string().min(1).max(120),
  source: z.object({
    name: z.string(),
    page: z.number().int().positive(),
    mode: z.enum(["sample", "ai", "import"]),
  }),
  items: z.array(ItemSchema).min(1).max(30),
  connections: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        type: z.enum(["process", "measurement", "signal"]),
        direction: z.enum(["forward", "unknown"]),
        evidence: z.string(),
        review: z.enum(["unreviewed", "confirmed"]),
        provenance: z.enum(["extracted", "user", "template"]),
      }),
    )
    .max(60),
  issues: z.array(
    z.object({
      id: z.string(),
      message: z.string(),
      severity: z.enum(["structural", "warning"]),
      status: z.enum(["unresolved", "resolved", "accepted"]),
      itemId: z.string().nullable(),
    }),
  ),
  assumptions: z.array(
    z.object({
      id: z.string(),
      message: z.string(),
      status: z.enum(["unresolved", "accepted"]),
      provenance: z.enum(["template", "simulation-default", "user"]),
    }),
  ),
});
export type Plant = z.infer<typeof PlantSchema>;
export type Item = Plant["items"][number];
export function validatePlant(m: Plant): string[] {
  const parsed = PlantSchema.safeParse(m);
  if (!parsed.success)
    return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const errors: string[] = [],
    ids = new Set<string>(),
    tags = new Set<string>();
  for (const i of m.items) {
    if (ids.has(i.id)) errors.push(`Duplicate internal ID ${i.id}`);
    ids.add(i.id);
    if (!i.tag.trim()) errors.push(`Missing engineering tag for ${i.id}`);
    if (tags.has(i.tag.trim().toUpperCase()))
      errors.push(`Duplicate engineering tag ${i.tag}`);
    tags.add(i.tag.trim().toUpperCase());
    if (i.kind === "unsupported")
      errors.push(
        `Unsupported component ${i.tag}: correct or remove after review`,
      );
    if (i.range && i.range.min >= i.range.max)
      errors.push(`Invalid range for ${i.tag}`);
    if (i.bbox.x + i.bbox.width > 1.001 || i.bbox.y + i.bbox.height > 1.001)
      errors.push(`Bounds extend outside page: ${i.tag}`);
    if (i.review !== "confirmed") errors.push(`Confirm review of ${i.tag}`);
  }
  const edges = new Set<string>();
  for (const e of m.connections) {
    if (edges.has(e.id)) errors.push(`Duplicate connection ID ${e.id}`);
    edges.add(e.id);
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to)
      errors.push(`Invalid endpoints: ${e.id}`);
    if (e.review === "unreviewed") errors.push(`Confirm connection ${e.id}`);
    const a = m.items.find((i) => i.id === e.from),
      b = m.items.find((i) => i.id === e.to);
    if (
      e.type === "process" &&
      [a, b].some((i) => i && ["level", "flow"].includes(i.kind))
    )
      errors.push(`Instrument cannot be inline in this template: ${e.id}`);
    if (
      e.type === "measurement" &&
      (!a ||
        !["level", "flow"].includes(a.kind) ||
        !b ||
        !["tank", "pump", "control-valve"].includes(b.kind))
    )
      errors.push(`Measurement must link instrument to equipment: ${e.id}`);
  }
  for (const i of m.issues)
    if (i.severity === "structural" && i.status !== "resolved")
      errors.push(i.message);
  for (const a of m.assumptions)
    if (a.status !== "accepted")
      errors.push(`Review and accept assumption: ${a.message}`);
  return errors;
}
export function supportedTopology(m: Plant): {
  ok: boolean;
  reason: string;
  chain?: string[];
} {
  const fail = (reason: string) => ({ ok: false, reason });
  if (validatePlant(m).length)
    return fail(
      "Resolve structural validation and confirm all items and connections first.",
    );
  const by = (k: Item["kind"]) => m.items.filter((i) => i.kind === k);
  if (
    by("tank").length !== 2 ||
    by("pump").length !== 1 ||
    by("control-valve").length !== 1 ||
    by("level").length !== 2 ||
    by("flow").length !== 1 ||
    m.items.length !== 7
  )
    return fail(
      "Demo simulation requires two tanks, one pump, one valve, two level instruments and one flow instrument.",
    );
  const pump = by("pump")[0].id,
    valve = by("control-valve")[0].id,
    process = m.connections.filter((e) => e.type === "process");
  const middle = process.find(
    (e) => e.from === pump && e.to === valve && e.direction === "forward",
  );
  const first = process.find(
    (e) =>
      by("tank").some((t) => t.id === e.from) &&
      e.to === pump &&
      e.direction === "forward",
  );
  const last = process.find(
    (e) =>
      e.from === valve &&
      by("tank").some((t) => t.id === e.to) &&
      e.direction === "forward",
  );
  if (
    !middle ||
    !first ||
    !last ||
    first.from === last.to ||
    process.length !== 3
  )
    return fail(
      "Only a reviewed directed tank → pump → valve → tank chain is supported. Unknown direction must be corrected with evidence or a documented demo assumption.",
    );
  const measurement = m.connections.filter((e) => e.type === "measurement");
  if (
    m.connections.length !== 6 ||
    measurement.length !== 3 ||
    by("level").some(
      (i) =>
        measurement.filter(
          (e) => e.from === i.id && by("tank").some((t) => t.id === e.to),
        ).length !== 1,
    ) ||
    new Set(
      by("level").map((i) => measurement.find((e) => e.from === i.id)?.to),
    ).size !== 2 ||
    !measurement.some((e) => e.from === by("flow")[0].id && e.to === valve)
  )
    return fail(
      "Each tank needs its own level measurement; flow measurement must relate to the valve process branch.",
    );
  return {
    ok: true,
    reason: "Reviewed tank-transfer topology",
    chain: [first.from, pump, valve, last.to],
  };
}
