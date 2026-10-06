import OpenAI from "openai";
import { PlantSchema, Plant } from "./model";
import { z } from "zod";
export const extractionPrompt = `Interpret this one P&ID page using simple ISA-style conventions: open-circle LT/FT instruments, vessel tanks, centrifugal pump circles, bow-tie control valves. Return only a plant model following the supplied JSON schema. Never generate project code. Keep unsupported symbols as unsupported items with issues. Do not assume crossing lines connect without junction evidence. Instruments are measurement relationships, not inline pipe equipment. Keep flow directions unknown unless arrows establish them. Do not infer ranges, units, control strategy or alarm limits from tags; null if not explicitly visible. Record evidence, normalized bounding boxes, page and provenance extracted. All detections and connections must be unreviewed. Editable tag may be empty if absent; never mistake plausible names for evidence. IDs must be unique and stable within this response. Record ambiguous connectivity as structural unresolved issues. Source mode ai. Assumptions must be explicitly unresolved template proposals. schemaVersion 1.0.`;
export async function extract(
  image: string,
  page: number,
  name: string,
  signal: AbortSignal,
): Promise<Plant> {
  const key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL || "gpt-6-astra";
  if (!key)
    throw new Error(
      "AI extraction is not configured. Set OPENAI_API_KEY on the server, or use the clearly labelled sample fixture.",
    );
  // Complex vision models can need more than 40 seconds. The route's shared
  // 90-second abort still bounds both attempts, and the browser waits 100s.
  const client = new OpenAI({ apiKey: key, timeout: 80_000, maxRetries: 0 });
  const schema = z.toJSONSchema(PlantSchema);
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.responses.create(
      {
        model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  extractionPrompt +
                  `\nSource: ${JSON.stringify({ page, name })}. ${attempt ? "Previous output failed validation: " + last : ""}`,
              },
              { type: "input_image", image_url: image, detail: "high" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "plant_model",
            schema: schema as Record<string, unknown>,
            strict: true,
          },
        },
        max_output_tokens: 8000,
      },
      { signal },
    );
    try {
      const parsed = PlantSchema.parse(JSON.parse(response.output_text));
      return {
        ...parsed,
        source: { name, page, mode: "ai" },
        items: parsed.items.map((i) => ({
          ...i,
          page,
          provenance: "extracted",
          review: "unreviewed",
        })),
        connections: parsed.connections.map((e) => ({
          ...e,
          review: "unreviewed",
          provenance: "extracted",
        })),
        issues: parsed.issues.map((i) => ({ ...i, status: "unresolved" })),
        assumptions: [
          ...parsed.assumptions.filter((a) => a.id !== "studio_demo"),
          {
            id: "studio_demo",
            message:
              "Demo only: 1000 L tanks, maximum 20 L/s, linear valve response, initial volumes 800/200 L; no PID or alarms inferred.",
            status: "unresolved" as const,
            provenance: "simulation-default" as const,
          },
        ].map((a) => ({
          ...a,
          status: "unresolved",
        })),
      };
    } catch (e) {
      last = e instanceof Error ? e.message.slice(0, 700) : "Malformed JSON";
    }
  }
  throw new Error(
    "Extraction returned an invalid model after two attempts. Try a clearer crop or upload another page. Details: " +
      last,
  );
}
