import type { Action } from "./config.js";

export interface EventRow {
  id: string;
  time: string;
  kind: string;
  head: string | null;
  detail: string | null;
}

export interface ActionRun {
  id: string;
  action: string;
  reason: string;
  head: string | null;
  started: string;
  ended: string | null;
  exit_code: number | null;
  error: string | null;
  log: string;
  status: string;
}

export interface AgentRun {
  id: string;
  prompt: string;
  worktree: string;
  branch: string;
  base: string;
  started: string;
  ended: string | null;
  exit_code: number | null;
  error: string | null;
  output: string;
  status: string;
}

export interface Snapshot {
  repo: string;
  root: string;
  state: string;
  remote: string;
  branch: string | null;
  head: string | null;
  problem: string | null;
  poll_seconds: number;
  timer_seconds: number | null;
  actions: Action[];
  events: EventRow[];
  action_runs: ActionRun[];
  agents: AgentRun[];
}

export interface Reply {
  ok: boolean;
  id?: string;
  error?: string;
}
