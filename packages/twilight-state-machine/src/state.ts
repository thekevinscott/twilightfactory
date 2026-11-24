// One entry of `gh run list --json status,conclusion,createdAt,headSha`.
export interface Run {
  status: string;
  conclusion: string;
  createdAt: string;
  headSha: string;
}

// Each input is fetched only when the state depends on it.
export interface Inputs<Args extends unknown[] = []> {
  lastRun: (...args: Args) => Promise<Run | null>;
  // The head commit of the default branch.
  head: (...args: Args) => Promise<string>;
}

export type State = "STOP" | "GO";

const HOUR = 60 * 60 * 1000;

export const state = async <Args extends unknown[]>(
  inputs: Inputs<Args>,
  args: Args,
  now: Date = new Date(),
): Promise<State> => {
  const lastRun = await inputs.lastRun(...args);
  if (lastRun === null) {
    return "GO";
  }
  if (lastRun.status !== "completed" || lastRun.conclusion === "failure") {
    return "STOP";
  }
  if (now.getTime() - new Date(lastRun.createdAt).getTime() < HOUR) {
    return "STOP";
  }
  return lastRun.headSha === (await inputs.head(...args)) ? "STOP" : "GO";
};
