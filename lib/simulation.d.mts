export interface SimState {
  source: number;
  destination: number;
  flow: number;
  running: boolean;
  fault: boolean;
  elapsed: number;
}
export interface Command {
  pump: boolean;
  valve: number;
  fault: boolean;
}
export const parameters: Readonly<{ capacity: number; maxFlow: number }>;
export function initialState(source?: number, destination?: number): SimState;
export function step(state: SimState, command: Command, dt: number): SimState;
export function telemetry(
  state: SimState,
  command: Command,
): Record<string, number>;
