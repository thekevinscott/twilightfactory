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
  // The commit of the newest green tag.
  lastGreenTag: (...args: Args) => Promise<string | null>;
  // The commit of the newest stored speed and memory results.
  lastResults: (...args: Args) => Promise<string | null>;
  // The head commit of the default branch.
  head: (...args: Args) => Promise<string>;
}

export type State = "STOP" | "GO_PLAIN" | "GO_MEASURED" | "PUSH_TAG" | "PUSH_RESULTS";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const once = <Value>(fetch: () => Promise<Value>) => {
  let value: Promise<Value> | undefined;
  return () => (value ??= fetch());
};

const sameRun = (a: Run | null, b: Run) => a !== null && a.createdAt === b.createdAt && a.headSha === b.headSha;

export const state = async <Args extends unknown[]>(
  inputs: Inputs<Args>,
  args: Args,
  now: Date = new Date(),
): Promise<State> => {
  const lastRun = await inputs.lastRun(...args);
  const lastMeasuredRun = once(() => inputs.lastMeasuredRun(...args));
  if (lastRun === null) {
    return "GO_MEASURED";
  }
  if (lastRun.status !== "completed" || lastRun.conclusion === "failure") {
    return "STOP";
  }
  if (lastRun.conclusion === "success") {
    if ((await inputs.lastGreenTag(...args)) !== lastRun.headSha) {
      return "PUSH_TAG";
    }
    if (sameRun(await lastMeasuredRun(), lastRun) && (await inputs.lastResults(...args)) !== lastRun.headSha) {
      return "PUSH_RESULTS";
    }
  }
  if (now.getTime() - new Date(lastRun.createdAt).getTime() < HOUR) {
    return "STOP";
  }
  if (lastRun.headSha === (await inputs.head(...args))) {
    return "STOP";
  }
  const measured = await lastMeasuredRun();
  if (measured === null || now.getTime() - new Date(measured.createdAt).getTime() >= DAY) {
    return "GO_MEASURED";
  }
  return "GO_PLAIN";
};
