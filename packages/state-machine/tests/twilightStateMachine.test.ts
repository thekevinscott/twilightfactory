import { expect, test } from "vitest";
import { type Run, type State, twilightStateMachine } from "../src/index.js";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
const run = (status: string, conclusion: string, minutes: number, headSha: string): Run => ({
  status,
  conclusion,
  createdAt: minutesAgo(minutes),
  headSha,
});
const HOURS = 60;

interface Case {
  name: string;
  inputs: {
    lastRun: Run | null;
    lastMeasuredRun: Run | null;
    head: string;
    openRedIssue?: boolean;
  };
  outputs: { state: State; fetched: string[] };
}

const passed2h = run("completed", "success", 2 * HOURS, "aaa");
const measured2h = passed2h;
const measured25h = run("completed", "success", 25 * HOURS, "zzz");

const passed = (minutes: number, headSha = "aaa") => run("completed", "success", minutes, headSha);
const failed = (minutes: number) => run("completed", "failure", minutes, "aaa");

const cases: Case[] = [
  // No history
  {
    name: "never run",
    inputs: { lastRun: null, lastMeasuredRun: null, head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun"] },
  },

  // A run is underway
  {
    name: "a run is queued",
    inputs: { lastRun: run("queued", "", 1, "aaa"), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "a run is in progress",
    inputs: { lastRun: run("in_progress", "", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "a run has been in progress for two hours",
    inputs: { lastRun: run("in_progress", "", 2 * HOURS, "aaa"), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },

  // Red
  {
    name: "failed 30 minutes ago, no red issue",
    inputs: { lastRun: failed(30), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "FILE_ISSUE", fetched: ["lastRun", "openRedIssue"] },
  },
  {
    name: "failed two hours ago, new commits, no red issue",
    inputs: { lastRun: failed(2 * HOURS), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "FILE_ISSUE", fetched: ["lastRun", "openRedIssue"] },
  },
  {
    name: "failed 30 minutes ago, red issue open",
    inputs: { lastRun: failed(30), lastMeasuredRun: measured25h, head: "bbb", openRedIssue: true },
    outputs: { state: "STOP", fetched: ["lastRun", "openRedIssue"] },
  },
  {
    name: "failed two days ago, red issue open",
    inputs: { lastRun: failed(48 * HOURS), lastMeasuredRun: measured25h, head: "bbb", openRedIssue: true },
    outputs: { state: "STOP", fetched: ["lastRun", "openRedIssue"] },
  },
  {
    name: "failed measured run, no red issue",
    inputs: { lastRun: failed(2 * HOURS), lastMeasuredRun: failed(2 * HOURS), head: "bbb" },
    outputs: { state: "FILE_ISSUE", fetched: ["lastRun", "openRedIssue"] },
  },

  // Green again
  {
    name: "passed, red issue still open",
    inputs: { lastRun: passed(30), lastMeasuredRun: measured25h, head: "bbb", openRedIssue: true },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },

  // Green, waiting
  {
    name: "passed 30 minutes ago, new commits",
    inputs: { lastRun: passed(30), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "passed 59 minutes ago, new commits",
    inputs: { lastRun: passed(59), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "passed two hours ago, no new commits, measured run overdue",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "lastMeasuredRun", "head"] },
  },
  {
    name: "passed two days ago, no new commits",
    inputs: { lastRun: passed(48 * HOURS), lastMeasuredRun: passed(48 * HOURS), head: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "lastMeasuredRun", "head"] },
  },

  // Green, go
  {
    name: "passed two hours ago, new commits, measured two hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured2h, head: "bbb" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "lastMeasuredRun", "head"] },
  },
  {
    name: "passed two hours ago, new commits, measured 23 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: passed(23 * HOURS, "yyy"), head: "bbb" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "lastMeasuredRun", "head"] },
  },
  {
    name: "passed two hours ago, new commits, measured 25 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastMeasuredRun", "head"] },
  },
  {
    name: "passed two hours ago, new commits, never measured",
    inputs: { lastRun: passed2h, lastMeasuredRun: null, head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastMeasuredRun", "head"] },
  },
  {
    name: "passed two hours ago, new commits, last measured run failed 25 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: failed(25 * HOURS), head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastMeasuredRun"] },
  },

  // Green after a fix, but the last measured run did not pass
  {
    name: "fixed 30 minutes ago by a plain run, measured run failed",
    inputs: { lastRun: passed(30), lastMeasuredRun: failed(3 * HOURS), head: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "fixed two hours ago by a plain run, measured run failed, no new commits",
    inputs: { lastRun: passed2h, lastMeasuredRun: failed(3 * HOURS), head: "aaa" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastMeasuredRun"] },
  },
  {
    name: "fixed two hours ago by a plain run, measured run failed, new commits",
    inputs: { lastRun: passed2h, lastMeasuredRun: failed(3 * HOURS), head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastMeasuredRun"] },
  },
];

test.for(cases)("$name is $outputs.state", async ({ inputs, outputs }) => {
  const fetched: string[] = [];
  const fetcher =
    <Value>(name: string, value: Value) =>
    async () => {
      fetched.push(name);
      return value;
    };

  const state = await twilightStateMachine({
    lastRun: fetcher("lastRun", inputs.lastRun),
    lastMeasuredRun: fetcher("lastMeasuredRun", inputs.lastMeasuredRun),
    head: fetcher("head", inputs.head),
    openRedIssue: fetcher("openRedIssue", inputs.openRedIssue ?? false),
  });

  expect({ state, fetched }).toEqual(outputs);
});

test.for([
  ["lastRun", passed2h],
  ["head", passed2h],
  ["lastMeasuredRun", passed2h],
  ["openRedIssue", failed(30)],
] as const)("a failure fetching %s is fatal", async ([failing, lastRun]) => {
  const fetch = <Value>(name: string, value: Value) => async () => {
    if (name === failing) {
      throw new Error(`could not fetch ${name}`);
    }
    return value;
  };

  await expect(
    twilightStateMachine({
      lastRun: fetch("lastRun", lastRun),
      head: fetch("head", "bbb"),
      lastMeasuredRun: fetch("lastMeasuredRun", measured25h),
      openRedIssue: fetch("openRedIssue", false),
    }),
  ).rejects.toThrow(`could not fetch ${failing}`);
});
