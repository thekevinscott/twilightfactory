import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as gh from "twilight-gh";
import { twilightStateMachine, type Inputs } from "twilight-state-machine";

const REFRESH_MS = 60 * 1000;

const githubRepo = async (cwd: string): Promise<string> => {
  const { stdout } = await promisify(execFile)("git", ["remote", "get-url", "origin"], { cwd });
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(stdout.trim());
  if (!match?.[1]) {
    throw new Error(`origin is not a GitHub repository: ${stdout.trim()}`);
  }
  return match[1];
};

const currentState = async (cwd: string): Promise<string> => {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    return "no GH_TOKEN";
  }
  const github = gh.client(token);
  const repo = await githubRepo(cwd);
  const inputs: Inputs = {
    lastRun: () => gh.lastRun(github, repo),
    lastMeasuredRun: () => gh.lastMeasuredRun(github, repo),
    head: () => gh.head(github, repo),
    openRedIssue: () => gh.openRedIssue(github, repo),
    blockedPullRequests: async () => (await gh.blockedPullRequests(github, repo)).length,
  };
  return twilightStateMachine(inputs);
};

export default function (pi: ExtensionAPI) {
  let timer: NodeJS.Timeout | undefined;

  const show = async (ctx: ExtensionContext) => {
    let text: string;
    try {
      text = await currentState(ctx.cwd);
    } catch (error) {
      text = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    ctx.ui.setStatus("tf", `tf: ${text}`);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }
    ctx.ui.setStatus("tf", "tf: …");
    void show(ctx);
    timer = setInterval(() => void show(ctx), REFRESH_MS);
  });

  pi.on("session_shutdown", async () => {
    clearInterval(timer);
    timer = undefined;
  });
}
