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
    blockedPullRequests?: number;
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
  {
    name: "a run is in progress, a pull request is blocked",
    inputs: { lastRun: run("in_progress", "", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb", blockedPullRequests: 2 },
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
  {
    name: "failed, red issue open, a pull request is blocked",
    inputs: { lastRun: failed(2 * HOURS), lastMeasuredRun: measured25h, head: "bbb", openRedIssue: true, blockedPullRequests: 2 },
    outputs: { state: "STOP", fetched: ["lastRun", "openRedIssue"] },
  },

  // Green again, pull requests still blocked
  {
    name: "passed 30 minutes ago, a pull request is blocked",
    inputs: { lastRun: passed(30), lastMeasuredRun: measured25h, head: "bbb", blockedPullRequests: 2 },
    outputs: { state: "RECHECK_PRS", fetched: ["lastRun", "blockedPullRequests"] },
  },
  {
    name: "passed two hours ago, new commits, a pull request is blocked",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "bbb", blockedPullRequests: 1 },
    outputs: { state: "RECHECK_PRS", fetched: ["lastRun", "blockedPullRequests"] },
  },
  {
    name: "passed, red issue still open, nothing blocked",
    inputs: { lastRun: passed(30), lastMeasuredRun: measured25h, head: "bbb", openRedIssue: true },
    outputs: { state: "STOP", fetched: ["lastRun", "blockedPullRequests"] },
  },

  // Green, waiting
  {
    name: "passed 30 minutes ago, new commits",
    inputs: { lastRun: passed(30), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun", "blockedPullRequests"] },
  },
  {
    name: "passed 59 minutes ago, new commits",
    inputs: { lastRun: passed(59), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun", "blockedPullRequests"] },
  },
  {
    name: "passed two hours ago, no new commits, measured run overdue",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "blockedPullRequests", "head"] },
  },
  {
    name: "passed two days ago, no new commits",
    inputs: { lastRun: passed(48 * HOURS), lastMeasuredRun: passed(48 * HOURS), head: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "blockedPullRequests", "head"] },
  },

  // Green, go
  {
    name: "passed two hours ago, new commits, measured two hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured2h, head: "bbb" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "blockedPullRequests", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed two hours ago, new commits, measured 23 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: passed(23 * HOURS, "yyy"), head: "bbb" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "blockedPullRequests", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed two hours ago, new commits, measured 25 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "blockedPullRequests", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed two hours ago, new commits, never measured",
    inputs: { lastRun: passed2h, lastMeasuredRun: null, head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "blockedPullRequests", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed two hours ago, new commits, last measured run failed 25 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: failed(25 * HOURS), head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "blockedPullRequests", "head", "lastMeasuredRun"] },
  },

  // Neither passed nor failed
  {
    name: "cancelled two hours ago, new commits",
    inputs: { lastRun: run("completed", "cancelled", 2 * HOURS, "aaa"), lastMeasuredRun: measured2h, head: "bbb" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "head", "lastMeasuredRun"] },
  },
  {
    name: "cancelled 30 minutes ago, new commits",
    inputs: { lastRun: run("completed", "cancelled", 30, "aaa"), lastMeasuredRun: measured2h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "cancelled two hours ago, no new commits",
    inputs: { lastRun: run("completed", "cancelled", 2 * HOURS, "aaa"), lastMeasuredRun: measured2h, head: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "head"] },
  },
  {
    name: "cancelled, a pull request is blocked",
    inputs: { lastRun: run("completed", "cancelled", 2 * HOURS, "aaa"), lastMeasuredRun: measured2h, head: "bbb", blockedPullRequests: 2 },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "head", "lastMeasuredRun"] },
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
    blockedPullRequests: fetcher("blockedPullRequests", inputs.blockedPullRequests ?? 0),
    openRedIssue: fetcher("openRedIssue", inputs.openRedIssue ?? false),
  });

  expect({ state, fetched }).toEqual(outputs);
});

test.for([
  ["lastRun", passed2h],
  ["blockedPullRequests", passed2h],
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
      blockedPullRequests: fetch("blockedPullRequests", 0),
      openRedIssue: fetch("openRedIssue", false),
    }),
  ).rejects.toThrow(`could not fetch ${failing}`);
});
