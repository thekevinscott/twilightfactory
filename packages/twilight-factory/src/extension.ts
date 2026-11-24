import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as gh from "twilight-gh";
import { twilightStateMachine, type Inputs } from "twilight-state-machine";
import { stateDisplay } from "./footer.js";
import { githubToken, NoClientIdError, type Verification } from "./token.js";

const REFRESH_MS = 60 * 1000;

const githubRepo = async (cwd: string): Promise<string> => {
  const { stdout } = await promisify(execFile)("git", ["remote", "get-url", "origin"], { cwd });
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(stdout.trim());
  if (!match?.[1]) {
    throw new Error(`origin is not a GitHub repository: ${stdout.trim()}`);
  }
  return match[1];
};

const currentState = async (cwd: string, onVerification: (verification: Verification) => void): Promise<string> => {
  let token: string;
  try {
    token = await githubToken(onVerification);
  } catch (error) {
    if (error instanceof NoClientIdError) return error.message;
    throw error;
  }
  const github = gh.client(token);
  const repo = await githubRepo(cwd);
  const inputs: Inputs = {
    hasWorkflow: () => gh.hasWorkflow(github, repo),
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
  const display = stateDisplay(pi);

  const show = async (ctx: ExtensionContext) => {
    let text: string;
    try {
      text = await currentState(ctx.cwd, ({ userCode, verificationUri }) => {
        ctx.ui.setWidget("tf-sign-in", [`Sign in to GitHub: enter ${userCode} at ${verificationUri}`]);
        display.show("SIGN_IN");
      });
    } catch (error) {
      text = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    ctx.ui.setWidget("tf-sign-in", undefined);
    display.show(text);
  };

  pi.registerCommand("tests", {
    description: "Start a tests run on main: /tests [plain|measured]",
    getArgumentCompletions: prefix =>
      (["plain", "measured"] as const).filter(kind => kind.startsWith(prefix)).map(kind => ({ value: kind, label: kind })),
    handler: async (args, ctx) => {
      const kind = args.trim() || "plain";
      if (kind !== "plain" && kind !== "measured") {
        ctx.ui.notify(`Unknown kind "${kind}": use plain or measured`, "error");
        return;
      }
      try {
        const github = gh.client(await githubToken(() => display.show("SIGN_IN")));
        await gh.startRun(github, await githubRepo(ctx.cwd), kind);
        ctx.ui.notify(`Started a ${kind} tests run`, "info");
        void show(ctx);
      } catch (error) {
        ctx.ui.notify(`Could not start a tests run: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }
    display.attach(ctx);
    void show(ctx);
    timer = setInterval(() => void show(ctx), REFRESH_MS);
  });

  pi.on("session_shutdown", async () => {
    clearInterval(timer);
    timer = undefined;
  });
}
