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
    lastGreenTag: string | null;
    lastResults?: string | null;
  };
  outputs: { state: State; fetched: string[] };
}

const passed2h = run("completed", "success", 2 * HOURS, "aaa");
const measured2h = passed2h;
const measured25h = run("completed", "success", 25 * HOURS, "zzz");
const measured30m = run("completed", "success", 30, "aaa");

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
    outputs: { state: "STOP", fetched: ["lastRun", "lastGreenTag", "lastMeasuredRun"] },
  },
  {
    name: "passed two hours ago, no new commits, measured run overdue",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "aaa", lastGreenTag: "aaa" },
    outputs: { state: "STOP", fetched: ["lastRun", "lastGreenTag", "lastMeasuredRun", "head"] },
  },
  {
    name: "passed two hours ago, new commits, measured two hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured2h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "GO_PLAIN", fetched: ["lastRun", "lastGreenTag", "lastMeasuredRun", "lastResults", "head"] },
  },
  {
    name: "passed two hours ago, new commits, measured 25 hours ago",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured25h, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastGreenTag", "lastMeasuredRun", "head"] },
  },
  {
    name: "passed two hours ago, new commits, never measured",
    inputs: { lastRun: passed2h, lastMeasuredRun: null, head: "bbb", lastGreenTag: "aaa" },
    outputs: { state: "GO_MEASURED", fetched: ["lastRun", "lastGreenTag", "lastMeasuredRun", "head"] },
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
  {
    name: "measured run passed 30 minutes ago, results not pushed",
    inputs: { lastRun: measured30m, lastMeasuredRun: measured30m, head: "bbb", lastGreenTag: "aaa", lastResults: "zzz" },
    outputs: { state: "PUSH_RESULTS", fetched: ["lastRun", "lastGreenTag", "lastMeasuredRun", "lastResults"] },
  },
  {
    name: "measured run passed two hours ago, new commits, results never pushed",
    inputs: { lastRun: passed2h, lastMeasuredRun: measured2h, head: "bbb", lastGreenTag: "aaa", lastResults: null },
    outputs: { state: "PUSH_RESULTS", fetched: ["lastRun", "lastGreenTag", "lastMeasuredRun", "lastResults"] },
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
    lastGreenTag: fetcher("lastGreenTag", inputs.lastGreenTag),
    lastResults: fetcher("lastResults", inputs.lastResults === undefined ? "aaa" : inputs.lastResults),
  });

  expect({ state, fetched }).toEqual(outputs);
});

test.for(["lastRun", "lastGreenTag", "lastMeasuredRun", "lastResults", "head"])("a failure fetching %s is fatal", async failing => {
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
      lastGreenTag: fetch("lastGreenTag", "aaa"),
      lastResults: fetch("lastResults", "aaa"),
    }),
  ).rejects.toThrow(`could not fetch ${failing}`);
});
