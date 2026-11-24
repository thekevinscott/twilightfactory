import { expect, test } from "vitest";
import { type Run, Stop, twilightStateMachine } from "../src/index.js";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
const run = (status: string, conclusion: string, minutes: number, headSha: string): Run => ({
  status,
  conclusion,
  createdAt: minutesAgo(minutes),
  headSha,
});
const HOURS = 60;

type State = "STOP" | "GO_PLAIN" | "GO_MEASURED" | "PUSH_TAG";

interface Case {
  name: string;
  inputs: { lastRun: Run | null; lastMeasuredRun: Run | null; head: string; lastGreenTag: string | null };
  outputs: { state: State; fetched: string[] };
}

const passed2h = run("completed", "success", 2 * HOURS, "aaa");
const measured2h = passed2h;
const measured25h = run("completed", "success", 25 * HOURS, "zzz");

const cases: Case[] = [
  {
    name: "never run",
    inputs: { lastRun: null, lastMeasuredRun: null, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun"] },
  },
  {
    name: "a run is queued",
    inputs: { lastRun: run("queued", "", 1, "aaa"), lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "a run is in progress",
    inputs: { lastRun: run("in_progress", "", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "a run has been in progress for two hours",
    inputs: { lastRun: run("in_progress", "", 2 * HOURS, "aaa"), lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "failed 30 minutes ago",
    inputs: { lastRun: run("completed", "failure", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "failed two hours ago, new commits",
    inputs: { lastRun: run("completed", "failure", 2 * HOURS, "aaa"), lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "passed 30 minutes ago, new commits",
    inputs: { lastRun: run("completed", "success", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "lastGreenTag"] },
  },
  {
    name: "passed two hours ago, no new commits, measured run overdue",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "aaa", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "lastGreenTag", "head"] },
  },
  {
    name: "passed two hours ago, new commits, measured two hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured2h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "lastGreenTag", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed two hours ago, new commits, measured 25 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastGreenTag", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed two hours ago, new commits, never measured",
    inputs: { lastRun: passed2h, lastMeasuredRun: null, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastGreenTag", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed 30 minutes ago, not tagged",
    inputs: { lastRun: run("completed", "success", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "zzz" },
    outputs: { state: "PUSH_TAG", fetched: ["lastRun", "lastGreenTag"] },
  },
  {
    name: "passed two hours ago, new commits, never tagged",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured2h, head: "bbb", lastGreenTag: null },
    outputs: { state: "PUSH_TAG", fetched: ["lastRun", "lastGreenTag"] },
  },
  {
    name: "cancelled two hours ago, not tagged",
    inputs: { lastRun: run("completed", "cancelled", 2 * HOURS, "aaa"), lastMeasuredRun: measured2h, head: "bbb", lastGreenTag: "zzz" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "head", "lastMeasuredRun"] },
  },
];

test.for(cases)("$name is $outputs.state, fetching $outputs.fetched", async ({ inputs: { lastRun, lastMeasuredRun, head, lastGreenTag }, outputs }) => {
  const calls: string[] = [];
  let reached: { state: State; fetched: string[] } | undefined;
  let current = lastRun;
  let tag = lastGreenTag;
  const fetchers = {
    lastRun: async () => {
      calls.push("lastRun");
      return current;
    },
    lastMeasuredRun: async () => {
      calls.push("lastMeasuredRun");
      return lastMeasuredRun;
    },
    head: async () => {
      calls.push("head");
      return head;
    },
    lastGreenTag: async () => {
      calls.push("lastGreenTag");
      return tag;
    },
  };
  const reach = (state: State) => {
    reached ??= { state, fetched: [...calls] };
  };
  const go = (state: State) => async () => {
    reach(state);
    current = run("queued", "", 0, head);
  };

  await twilightStateMachine(fetchers, {
    GO_PLAIN: go("GO_PLAIN"),
    GO_MEASURED: go("GO_MEASURED"),
    PUSH_TAG: async () => {
      reach("PUSH_TAG");
      tag = current?.headSha ?? null;
    },
    STOP: Stop,
  });

  expect(reached ?? { state: "STOP", fetched: calls }).toEqual(outputs);
});

test.for(["lastRun", "lastGreenTag", "head", "lastMeasuredRun"])("a failure fetching %s is fatal and runs no action", async failing => {
  const fetch = <Value>(name: string, value: Value) => async () => {
    if (name === failing) {
      throw new Error(`could not fetch ${name}`);
    }
    return value;
  };
  let acted = false;
  const act = async () => {
    acted = true;
  };

  await expect(
    twilightStateMachine(
      {
        lastRun: fetch("lastRun", passed2h),
        head: fetch("head", "bbb"),
        lastMeasuredRun: fetch("lastMeasuredRun", measured2h),
        lastGreenTag: fetch("lastGreenTag", "aaa"),
      },
      { GO_PLAIN: act, GO_MEASURED: act, PUSH_TAG: act, STOP: act },
    ),
  ).rejects.toThrow(`could not fetch ${failing}`);
  expect(acted).toBe(false);
});
