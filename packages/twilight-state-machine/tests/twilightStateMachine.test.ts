import { expect, test } from "vitest";
import { type Run, Stop, twilightStateMachine } from "../src/index.js";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
const run = (status: string, conclusion: string, minutes: number, headSha: string): Run => ({
  status,
  conclusion,
  createdAt: minutesAgo(minutes),
  headSha,
});

interface Case {
  name: string;
  lastRun: Run | null;
  head: string;
  state: "STOP" | "GO";
  fetched: string[];
}

const cases: Case[] = [
  { name: "never run", lastRun: null, head: "bbb", state: "GO", fetched: ["lastRun"] },
  { name: "a run is queued", lastRun: run("queued", "", 1, "aaa"), head: "bbb", state: "STOP", fetched: ["lastRun"] },
  { name: "a run is in progress", lastRun: run("in_progress", "", 30, "aaa"), head: "bbb", state: "STOP", fetched: ["lastRun"] },
  { name: "a run has been in progress for two hours", lastRun: run("in_progress", "", 120, "aaa"), head: "bbb", state: "STOP", fetched: ["lastRun"] },
  { name: "failed 30 minutes ago", lastRun: run("completed", "failure", 30, "aaa"), head: "bbb", state: "STOP", fetched: ["lastRun"] },
  { name: "failed two hours ago, new commits", lastRun: run("completed", "failure", 120, "aaa"), head: "bbb", state: "STOP", fetched: ["lastRun"] },
  { name: "passed 30 minutes ago, new commits", lastRun: run("completed", "success", 30, "aaa"), head: "bbb", state: "STOP", fetched: ["lastRun"] },
  { name: "passed two hours ago, no new commits", lastRun: run("completed", "success", 120, "aaa"), head: "aaa", state: "STOP", fetched: ["lastRun", "head"] },
  { name: "passed two hours ago, new commits", lastRun: run("completed", "success", 120, "aaa"), head: "bbb", state: "GO", fetched: ["lastRun", "head"] },
];

test.for(cases)("$name is $state, fetching $fetched", async ({ lastRun, head, state, fetched }) => {
  const calls: string[] = [];
  let reached: { state: string; fetched: string[] } | undefined;
  let current = lastRun;
  const inputs = {
    lastRun: async () => {
      calls.push("lastRun");
      return current;
    },
    head: async () => {
      calls.push("head");
      return head;
    },
  };

  await twilightStateMachine(inputs, {
    GO: async () => {
      reached = { state: "GO", fetched: [...calls] };
      current = run("queued", "", 0, head);
    },
    STOP: Stop,
  });

  expect(reached ?? { state: "STOP", fetched: calls }).toEqual({ state, fetched });
});

test.for(["lastRun", "head"])("a failure fetching %s is fatal and runs no action", async failing => {
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
      { lastRun: fetch("lastRun", run("completed", "success", 120, "aaa")), head: fetch("head", "bbb") },
      { GO: act, STOP: act },
    ),
  ).rejects.toThrow(`could not fetch ${failing}`);
  expect(acted).toBe(false);
});
