/** Demonstration only: two 1000 L tanks, 20 L/s maximum transfer. */
export const parameters = Object.freeze({ capacity: 1000, maxFlow: 20 });
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export function initialState(source = 800, destination = 200) {
  return {
    source: clamp(source, 0, 1000),
    destination: clamp(destination, 0, 1000),
    flow: 0,
    running: false,
    fault: false,
    elapsed: 0,
  };
}
export function step(state, command, dt) {
  if (!Number.isFinite(dt) || dt < 0 || dt > 60)
    throw new Error("Time step must be between 0 and 60 seconds");
  if (!Number.isFinite(command.valve))
    throw new Error("Valve command must be finite");
  const running =
    command.pump &&
    !command.fault &&
    state.source > 0 &&
    state.destination < 1000;
  const requested = running ? (20 * clamp(command.valve, 0, 100)) / 100 : 0;
  const transfer = Math.min(
    requested * dt,
    state.source,
    1000 - state.destination,
  );
  const source = state.source - transfer,
    destination = state.destination + transfer;
  return {
    source,
    destination,
    flow:
      source <= 0 || destination >= 1000
        ? 0
        : dt > 0
          ? transfer / dt
          : requested,
    running: running && source > 0 && destination < 1000,
    fault: command.fault,
    elapsed: state.elapsed + dt,
  };
}
export function telemetry(state, command) {
  return {
    sourceLevel: state.source / 10,
    destinationLevel: state.destination / 10,
    flow: state.flow,
    pumpRunning: Number(state.running),
    pumpFault: Number(state.fault),
    valveFeedback: clamp(command.valve, 0, 100),
  };
}
