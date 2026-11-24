import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Stop, stateMachine } from "../src/index.js";

test("a file-backed machine restarts without repeating work", async () => {
  const folder = mkdtempSync(join(tmpdir(), "state-machine-"));
  const advice = join(folder, "advice.txt");
  const score = join(folder, "score.txt");
  const calls: string[] = [];

  const readState = async () => {
    if (!existsSync(advice)) {
      return "advice_missing";
    }
    return existsSync(score) ? "done" : "unscored";
  };
  const writeAdvice = async () => {
    calls.push("advice");
    writeFileSync(advice, "Double the input.");
    throw new Error("stopped after publishing advice");
  };
  const scoreAdvice = async () => {
    calls.push("score");
    writeFileSync(score, String(readFileSync(advice, "utf8").length));
  };

  const actions = { advice_missing: writeAdvice, unscored: scoreAdvice, done: Stop };
  await expect(stateMachine(readState, actions)).rejects.toThrow("stopped after publishing advice");
  expect(readFileSync(advice, "utf8")).toBe("Double the input.");
  expect(existsSync(score)).toBe(false);

  await stateMachine(readState, actions);
  expect(readFileSync(score, "utf8")).toBe(String("Double the input.".length));
  expect(calls).toEqual(["advice", "score"]);
  expect(await readState()).toBe("done");
});

test("an unknown state throws", async () => {
  await expect(stateMachine(async () => "unknown", { done: Stop })).rejects.toThrow("unknown");
});

test("it forwards its arguments to state and action", async () => {
  const calls: string[] = [];
  const readState = async (events: string[]) => {
    events.push("state");
    return events.includes("action") ? "done" : "work";
  };
  const action = async (events: string[]) => {
    events.push("action");
  };

  await stateMachine(readState, { work: action, done: Stop }, calls);

  expect(calls).toEqual(["state", "action", "state"]);
});
