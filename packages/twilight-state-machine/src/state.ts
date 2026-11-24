// One entry of `gh run list --json status,conclusion,createdAt,headSha`.
export interface Run {
  status: string;
  conclusion: string;
  createdAt: string;
  headSha: string;
}

// Each input is fetched only when the state depends on it.
export interface Inputs<Args extends unknown[] = []> {
  // The latest run of either kind, plain or measured.
  lastRun: (...args: Args) => Promise<Run | null>;
  lastMeasuredRun: (...args: Args) => Promise<Run | null>;
  // The head commit of the default branch.
  head: (...args: Args) => Promise<string>;
  // Whether an issue for the red main branch is open.
  openRedIssue: (...args: Args) => Promise<boolean>;
  // Open pull requests whose main-is-green check failed.
  blockedPullRequests: (...args: Args) => Promise<number>;
}

export type State = "STOP" | "GO_PLAIN" | "GO_MEASURED" | "RECHECK_PRS" | "FILE_ISSUE";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const state = async <Args extends unknown[]>(
  inputs: Inputs<Args>,
  args: Args,
  now: Date = new Date(),
): Promise<State> => {
  const lastRun = await inputs.lastRun(...args);
  if (lastRun === null) {
    return "GO_MEASURED";
  }
  if (lastRun.status !== "completed") {
    return "STOP";
  }
  if (lastRun.conclusion === "failure") {
    return (await inputs.openRedIssue(...args)) ? "STOP" : "FILE_ISSUE";
  }
  if (lastRun.conclusion === "success" && (await inputs.blockedPullRequests(...args)) > 0) {
    return "RECHECK_PRS";
  }
  if (now.getTime() - new Date(lastRun.createdAt).getTime() < HOUR) {
    return "STOP";
  }
  if (lastRun.headSha === (await inputs.head(...args))) {
    return "STOP";
  }
  const lastMeasuredRun = await inputs.lastMeasuredRun(...args);
  if (lastMeasuredRun === null || now.getTime() - new Date(lastMeasuredRun.createdAt).getTime() >= DAY) {
    return "GO_MEASURED";
  }
  return "GO_PLAIN";
};
