import type { ActionRun, AgentRun, EventRow, Snapshot } from "./types.js";

function short(head: string | null): string {
  return head ? head.slice(0, 7) : "-------";
}

function clock(time: string | null): string {
  return time ? time.slice(0, 19).replace("T", " ") : "";
}

export function headLine(state: Snapshot): string {
  const branch = state.branch ? `${state.remote}/${state.branch}` : state.remote;
  const problem = state.problem ? `  problem: ${state.problem.split("\n")[0]}` : "";
  return `${state.repo}  ${branch} ${short(state.head)}${problem}`;
}

export function eventLine(event: EventRow): string {
  return `${clock(event.time)}  ${event.kind.padEnd(8)} ${short(event.head)}  ${event.detail ?? ""}`;
}

export function actionLine(run: ActionRun): string {
  const exit = run.exit_code === null ? "" : `exit ${run.exit_code}`;
  return `${clock(run.started)}  ${run.status.padEnd(7)} ${run.action.padEnd(16)} ${run.reason.padEnd(6)} ${exit}${run.error ? ` ${run.error}` : ""}  ${run.id}`;
}

export function agentLine(run: AgentRun): string {
  return `${clock(run.started)}  ${run.status.padEnd(7)} ${run.worktree}  ${run.prompt.split("\n")[0]?.slice(0, 40) ?? ""}`;
}

function section(title: string, lines: string[]): string[] {
  return ["", title, ...(lines.length ? lines.map((line) => `  ${line}`) : ["  none"])];
}

function cadence(state: Snapshot): string {
  const timer = state.timer_seconds === null ? "no timer" : `timer ${state.timer_seconds}s`;
  return `poll ${state.poll_seconds}s, ${timer}`;
}

export function widgetLines(state: Snapshot): string[] {
  return [
    `${headLine(state)}  ${cadence(state)}`,
    ...state.actions.map((action) => {
      const last = state.action_runs.find((run) => run.action === action.name);
      const result = last
        ? `${last.status}${last.exit_code === null ? "" : ` exit ${last.exit_code}`}  ${clock(last.started)}  ${last.reason}`
        : "not run yet";
      return `  ${action.name} [${action.on.join(", ")}]  ${result}`;
    }),
  ];
}

export function statusText(state: Snapshot, limit = 10): string {
  const actions = state.actions.map((action) => `${action.name} [${action.on.join(", ")}]: ${action.command}`);
  return [
    headLine(state),
    cadence(state),
    `state ${state.state}`,
    ...section("actions", actions),
    ...section("events", state.events.slice(0, limit).map(eventLine)),
    ...section("action runs", state.action_runs.slice(0, limit).map(actionLine)),
    ...section("agents", state.agents.slice(0, limit).map(agentLine)),
  ].join("\n");
}
