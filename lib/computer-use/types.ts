export interface AgentRun {
  id: string;
  status:
    | "running"
    | "stopping"
    | "passed"
    | "failed"
    | "cancelled"
    | "needs-attention";
  phase: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
  screenshot?: string;
  checks: { name: string; readings?: Record<string, number> }[];
  events: string[];
  pumpStopped?: boolean;
}
