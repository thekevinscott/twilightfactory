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
  };
  outputs: { state: State; fetched: string[] };
}

const passed2h = run("completed", "success", 2 * HOURS, "aaa");
const measured2h = passed2h;
const measured25h = run("completed", "success", 25 * HOURS, "zzz");

const cases: Case[] = [
  {
    name: "never run",
    inputs: { lastRun: null, lastMeasuredRun: null, head: "bbb" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun"] },
  },
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
    name: "failed 30 minutes ago",
    inputs: { lastRun: run("completed", "failure", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "failed two hours ago, new commits",
    inputs: { lastRun: run("completed", "failure", 2 * HOURS, "aaa"), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun"] },
  },
  {
    name: "passed 30 minutes ago, new commits",
    inputs: { lastRun: run("completed", "success", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb" },
    outputs: { state: "STOP", fetched: ["lastRun", "blockedPullRequests"] },
  },
  {
    name: "passed two hours ago, no new commits, measured run overdue",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "blockedPullRequests", "head"] },
  },
  {
    name: "passed two hours ago, new commits, measured two hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured2h, head: "bbb" },
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
    name: "cancelled two hours ago, new commits",
    inputs: { lastRun: run("completed", "cancelled", 2 * HOURS, "aaa"), lastMeasuredRun: measured2h, head: "bbb" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "head", "lastMeasuredRun"] },
  },
  {
    name: "passed 30 minutes ago, a pull request is blocked",
    inputs: { lastRun: run("completed", "success", 30, "aaa"), lastMeasuredRun: measured25h, head: "bbb", blockedPullRequests: 2 },
    outputs: { state: "RECHECK_PRS", fetched: ["lastRun", "blockedPullRequests"] },
  },
  {
    name: "failed two hours ago, a pull request is blocked",
    inputs: { lastRun: run("completed", "failure", 2 * HOURS, "aaa"), lastMeasuredRun: measured25h, head: "bbb", blockedPullRequests: 2 },
    outputs: { state: "STOP", fetched: ["lastRun"] },
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
  });

  expect({ state, fetched }).toEqual(outputs);
});

test.for(["lastRun", "blockedPullRequests", "lastMeasuredRun", "head"])("a failure fetching %s is fatal", async failing => {
  const fetch = <Value>(name: string, value: Value) => async () => {
    if (name === failing) {
      throw new Error(`could not fetch ${name}`);
    }
    return value;
  };

  await expect(
    twilightStateMachine({
      lastRun: fetch("lastRun", passed2h),
      head: fetch("head", "bbb"),
      lastMeasuredRun: fetch("lastMeasuredRun", measured2h),
      blockedPullRequests: fetch("blockedPullRequests", 0),
    }),
  ).rejects.toThrow(`could not fetch ${failing}`);
});
