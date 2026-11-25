import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as gh from "twilight-gh";
import { twilightStateMachine, type Inputs } from "twilight-state-machine";
import { stateDisplay } from "./footer.js";
import { pullRequestPane } from "./pr-pane.js";
import { githubToken, NoClientIdError, type Verification } from "./token.js";

const REFRESH_MS = 60 * 1000;
const POLL_MS = Number(process.env.TF_POLL_MS) || 60 * 1000;

const githubRepo = async (cwd: string): Promise<string> => {
  const { stdout } = await promisify(execFile)("git", ["remote", "get-url", "origin"], { cwd });
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(stdout.trim());
  if (!match?.[1]) {
    throw new Error(`origin is not a GitHub repository: ${stdout.trim()}`);
  }
  return match[1];
};

// GitHub can take a few seconds to list a dispatched run, so remember which head we already started.
let startedFor: string | undefined;

const currentState = async (github: ReturnType<typeof gh.client>, repo: string): Promise<string> => {
  let headSha: string | undefined;
  const inputs: Inputs = {
    hasWorkflow: () => gh.hasWorkflow(github, repo),
    lastRun: () => gh.lastRun(github, repo),
    lastMeasuredRun: () => gh.lastMeasuredRun(github, repo),
    head: async () => (headSha = await gh.head(github, repo)),
    openRedIssue: () => gh.openRedIssue(github, repo),
    blockedPullRequests: async () => (await gh.blockedPullRequests(github, repo)).length,
  };
  const state = await twilightStateMachine(inputs);
  if (state === "GO_PLAIN" || state === "GO_MEASURED") {
    // GO_MEASURED can be decided before the state machine reads head.
    const sha = headSha ?? (await inputs.head());
    if (sha !== startedFor) {
      await gh.startRun(github, repo, state === "GO_PLAIN" ? "plain" : "measured");
      startedFor = sha;
    }
  }
  return state;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Polls only; webhooks need a registered hook or a smee channel.
const pullRequestEvents = async (cwd: string, onVerification: (verification: Verification) => void, onError: (error: unknown) => void) => {
  const github = gh.client(await githubToken(onVerification));
  const events = gh.eventSource({
    github,
    repo: await githubRepo(cwd),
    sources: [gh.pullRequestOpened()],
    interval: POLL_MS,
    onError: (error, event) => onError(event ? new Error(`auto-merge on #${(event.data as gh.PullRequest).number}: ${message(error)}`) : error),
  });
  events.on<gh.PullRequest>("pull_request.opened", ({ data }) => gh.enableAutoMerge(github, data));
  return events;
};

export default function (pi: ExtensionAPI) {
  let timer: NodeJS.Timeout | undefined;
  let events: gh.EventSource | undefined;
  const display = stateDisplay(pi);
  const pane = pullRequestPane();

  const signIn = (ctx: ExtensionContext) => ({ userCode, verificationUri }: Verification) => {
    ctx.ui.setWidget("tf-sign-in", [`Sign in to GitHub: enter ${userCode} at ${verificationUri}`]);
    display.show("SIGN_IN");
  };

  const show = async (ctx: ExtensionContext) => {
    let github: ReturnType<typeof gh.client>;
    let repo: string;
    try {
      github = gh.client(await githubToken(signIn(ctx)));
      repo = await githubRepo(ctx.cwd);
    } catch (error) {
      ctx.ui.setWidget("tf-sign-in", undefined);
      display.show(error instanceof NoClientIdError ? error.message : `error: ${message(error)}`);
      return;
    }
    ctx.ui.setWidget("tf-sign-in", undefined);
    await Promise.all([
      currentState(github, repo).then(display.show, (error: unknown) => display.show(`error: ${message(error)}`)),
      gh.recentPullRequests(github, repo).then(pane.show, (error: unknown) => pane.fail(message(error))),
    ]);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }
    display.attach(ctx);
    pane.attach(ctx);
    void show(ctx);
    timer = setInterval(() => void show(ctx), REFRESH_MS);
    const onError = (error: unknown) => ctx.ui.notify(`tf: ${message(error)}`, "warning");
    pullRequestEvents(ctx.cwd, signIn(ctx), onError)
      .then(source => {
        if (timer === undefined) return;
        events = source;
        return source.start();
      })
      .catch(error => {
        // The state display already reports a missing client id.
        if (!(error instanceof NoClientIdError)) onError(error);
      });
  });

  pi.on("session_shutdown", async () => {
    clearInterval(timer);
    timer = undefined;
    await events?.stop();
    events = undefined;
    pane.dispose();
  });
}
