function short(head) {
    return head ? head.slice(0, 7) : "-------";
}
function clock(time) {
    return time ? time.slice(0, 19).replace("T", " ") : "";
}
export function headLine(state) {
    const branch = state.branch ? `${state.remote}/${state.branch}` : state.remote;
    const problem = state.problem ? `  problem: ${state.problem.split("\n")[0]}` : "";
    return `${state.repo}  ${branch} ${short(state.head)}${problem}`;
}
export function eventLine(event) {
    return `${clock(event.time)}  ${event.kind.padEnd(8)} ${short(event.head)}  ${event.detail ?? ""}`;
}
export function actionLine(run) {
    const exit = run.exit_code === null ? "" : `exit ${run.exit_code}`;
    return `${clock(run.started)}  ${run.status.padEnd(7)} ${run.action.padEnd(16)} ${run.reason.padEnd(6)} ${exit}${run.error ? ` ${run.error}` : ""}  ${run.id}`;
}
export function agentLine(run) {
    return `${clock(run.started)}  ${run.status.padEnd(7)} ${run.worktree}  ${run.prompt.split("\n")[0]?.slice(0, 40) ?? ""}`;
}
const NOT_FAILED = ["success", "skipped", "neutral", "cancelled"];
function failed(run) {
    return run.conclusion !== null && !NOT_FAILED.includes(run.conclusion);
}
export function workflowLine(run) {
    const mark = failed(run) ? "FAILED " : "";
    return `${mark}${run.name}  ${run.conclusion ?? run.status}  ${short(run.head)}  ${clock(run.created)}  ${run.url}`;
}
function workflowLines(state) {
    return state.workflows_note
        ? [`not watched: ${state.workflows_note}`]
        : [...state.workflows].sort((a, b) => Number(failed(b)) - Number(failed(a))).map(workflowLine);
}
function section(title, lines) {
    return ["", title, ...(lines.length ? lines.map((line) => `  ${line}`) : ["  none"])];
}
function cadence(state) {
    const timer = state.timer_seconds === null ? "no timer" : `timer ${state.timer_seconds}s`;
    return `poll ${state.poll_seconds}s, ${timer}`;
}
export function widgetLines(state, bad = (line) => line) {
    const done = state.workflows.filter((run) => run.conclusion !== null);
    const broken = state.workflows.filter(failed);
    const counts = `${done.length - broken.length} ok, ${broken.length} failed, ${state.workflows.length - done.length} running`;
    return [
        `${headLine(state)}  ${cadence(state)}`,
        ...state.actions.map((action) => {
            const last = state.action_runs.find((run) => run.action === action.name);
            const result = last
                ? `${last.status}${last.exit_code === null ? "" : ` exit ${last.exit_code}`}  ${clock(last.started)}  ${last.reason}`
                : "not run yet";
            const line = `  ${action.name} [${action.on.join(", ")}]  ${result}`;
            return last?.status === "failed" ? bad(line) : line;
        }),
        `  workflows  ${state.workflows_note ? `not watched: ${state.workflows_note}` : counts}`,
        ...broken.map((run) => bad(`    ${workflowLine(run)}`)),
    ];
}
export function statusText(state, limit = 10) {
    const actions = state.actions.map((action) => `${action.name} [${action.on.join(", ")}]: ${action.command}`);
    return [
        headLine(state),
        cadence(state),
        `state ${state.state}`,
        ...section("actions", actions),
        ...section("workflows", workflowLines(state)),
        ...section("events", state.events.slice(0, limit).map(eventLine)),
        ...section("action runs", state.action_runs.slice(0, limit).map(actionLine)),
        ...section("agents", state.agents.slice(0, limit).map(agentLine)),
    ].join("\n");
}
