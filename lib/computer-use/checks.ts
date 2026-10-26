import type { generateHmi } from "../generate";

export type Readings = Record<string, number>;
export function verifyReadings(
  values: Readings,
  expected: Readings,
  before?: Readings,
) {
  const keys = [
    "sourceLevel",
    "destinationLevel",
    "flow",
    "pumpRunning",
    "pumpFault",
    "valveFeedback",
  ];
  if (keys.some((key) => !Number.isFinite(values[key]))) return false;
  if (
    values.sourceLevel < 0 ||
    values.sourceLevel > 100 ||
    values.destinationLevel < 0 ||
    values.destinationLevel > 100 ||
    values.pumpFault !== 0
  )
    return false;
  if (
    Object.entries(expected).some(
      ([key, value]) => Math.abs(values[key] - value) > 0.05,
    )
  )
    return false;
  if (
    before &&
    (!(values.sourceLevel < before.sourceLevel) ||
      !(values.destinationLevel > before.destinationLevel) ||
      Math.abs(
        values.sourceLevel +
          values.destinationLevel -
          before.sourceLevel -
          before.destinationLevel,
      ) > 0.3)
  )
    return false;
  return true;
}

export function verifyExport(
  value: unknown,
  generated: ReturnType<typeof generateHmi>,
) {
  try {
    const project = value as typeof generated.project;
    const mqtt = project.devices.d_mqtt;
    if (
      !mqtt.enabled ||
      mqtt.type !== "MQTTclient" ||
      mqtt.property.address !== "mqtt://broker:1883"
    )
      return false;
    // No extra connections to external devices may be introduced by the agent.
    if (
      Object.keys(project.devices).some((id) => !["0", "d_mqtt"].includes(id))
    )
      return false;
    const view = project.hmi.views.find((v) => v.id === "view_overview");
    if (!view) return false;
    for (const tag of generated.tags) {
      const actual = mqtt.tags[tag.id] as {
        address?: string;
        access?: string;
        type?: string;
      };
      if (
        !actual ||
        actual.address !== tag.topic ||
        actual.type !== "raw" ||
        actual.access !== (tag.direction === "command" ? "rw" : "r")
      )
        return false;
    }
    for (const [id, gauge] of Object.entries(
      generated.project.hmi.views[0].items,
    )) {
      if (
        !view.items[id] ||
        view.items[id].property.variableId !== gauge.property.variableId ||
        !view.svgcontent.includes(`id="${id}"`)
      )
        return false;
      if (
        id.startsWith("command_") &&
        JSON.stringify(view.items[id].property.events) !==
          JSON.stringify(gauge.property.events)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
