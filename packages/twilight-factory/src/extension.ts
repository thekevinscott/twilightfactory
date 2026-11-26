import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as gh from "twilight-gh";
import { twilightStateMachine, type Inputs } from "twilight-state-machine";
import { chatContext } from "./chat-context.js";
import { stateDisplay } from "./footer.js";
import { registerConflictResolver, startConflictResolver } from "./conflict-resolver.js";
import { pullRequestPane } from "./pr-pane.js";
import { registerRedFixer, startRedFixer } from "./red-fixer.js";
import { appConfigFile, githubToken, NoClientIdError, type Verification } from "./token.js";
import { removeMergedWorktree } from "./worktrees.js";

const REFRESH_MS = Number(process.env.TF_REFRESH_MS) || 60 * 1000;
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
let fixingFor: number | undefined;

type FailedRun = Pick<gh.Run, "id" | "url" | "headSha">;

const currentState = async (token: string, repo: string, onRed: (run: FailedRun) => Promise<void>): Promise<string> => {
  const github = gh.client(token);
  // Read on every refresh so a broken app config shows in the footer rather than falling back to the user.
  const app = await gh.readAppConfig(appConfigFile());
  let headSha: string | undefined;
  const seen: { lastRun?: gh.Run | null } = {};
  const inputs: Inputs = {
    lastRun: async () => (seen.lastRun = await gh.lastRun(github, repo)),
    lastMeasuredRun: () => gh.lastMeasuredRun(github, repo),
    head: async () => (headSha = await gh.head(github, repo)),
    openRedIssue: () => gh.openRedIssue(github, repo),
  };
  const state = await twilightStateMachine(inputs);
  if (state === "GO_PLAIN" || state === "GO_MEASURED") {
    // GO_MEASURED can be decided before the state machine reads head.
    const sha = headSha ?? (await inputs.head());
    if (sha !== startedFor) {
      await gh.startRun(gh.dispatchClient(token, app), repo, state === "GO_PLAIN" ? "plain" : "measured");
      startedFor = sha;
    }
  }
  // FILE_ISSUE holds until the fixer files its issue, so start it once per failed run.
  const run = seen.lastRun;
  if (state === "FILE_ISSUE" && run && run.id !== fixingFor) {
    fixingFor = run.id;
    try {
      await onRed(run);
    } catch (error) {
      fixingFor = undefined;
      throw error;
    }
  }
  return state;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Polls only; webhooks need a registered hook or a smee channel.
const pullRequestEvents = async (
  cwd: string,
  onVerification: (verification: Verification) => void,
  onError: (error: unknown) => void,
  onInfo: (text: string) => void,
  onConflict: (pr: gh.ConflictedPullRequest) => Promise<void>,
) => {
  const github = gh.client(await githubToken(onVerification));
  const events = gh.eventSource({
    github,
    repo: await githubRepo(cwd),
    sources: [gh.pullRequestOpened(), gh.pullRequestClosed(), gh.pullRequestConflicted()],
    interval: POLL_MS,
    onError: (error, event) =>
      onError(event ? new Error(`${event.type} #${(event.data as gh.PullRequest).number}: ${message(error)}`) : error),
  });
  events.on<gh.PullRequest>("pull_request.opened", ({ data }) => gh.enableAutoMerge(github, data));
  events.on<gh.ClosedPullRequest>("pull_request.closed", async ({ data }) => {
    if (!data.merged) return;
    const result = await removeMergedWorktree(cwd, data.head);
    if (result) onInfo(`tf: #${data.number} merged: ${result}`);
  });
  events.on<gh.ConflictedPullRequest>("pull_request.conflicted", ({ data }) => onConflict(data));
  return events;
};

export default function (pi: ExtensionAPI) {
  let timer: NodeJS.Timeout | undefined;
  let events: gh.EventSource | undefined;
  let agents: { dispose(): void }[] = [];
  const display = stateDisplay(pi);
  const pane = pullRequestPane();
  let state: string | undefined;
  chatContext(pi, { repo: githubRepo, github: async () => gh.client(await githubToken(() => {})), state: () => state });

  const signIn = (ctx: ExtensionContext) => ({ userCode, verificationUri }: Verification) => {
    ctx.ui.setWidget("tf-sign-in", [`Sign in to GitHub: enter ${userCode} at ${verificationUri}`]);
    display.show("SIGN_IN");
  };

  const show = async (ctx: ExtensionContext) => {
    const showState = (text: string) => {
      state = text;
      display.show(text);
    };
    let token: string;
    let repo: string;
    try {
      token = await githubToken(signIn(ctx));
      repo = await githubRepo(ctx.cwd);
    } catch (error) {
      ctx.ui.setWidget("tf-sign-in", undefined);
      showState(error instanceof NoClientIdError ? error.message : `error: ${message(error)}`);
      return;
    }
    ctx.ui.setWidget("tf-sign-in", undefined);
    await Promise.all([
      currentState(token, repo, run => startRedFixer(pi, ctx.cwd, run)).then(showState, (error: unknown) =>
        showState(`error: ${message(error)}`),
      ),
      gh.recentPullRequests(gh.client(token), repo).then(pane.show, (error: unknown) => pane.fail(message(error))),
    ]);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }
    display.attach(ctx);
    pane.attach(ctx);
    agents = [registerRedFixer(pi), registerConflictResolver(pi)];
    void show(ctx);
    timer = setInterval(() => void show(ctx), REFRESH_MS);
    const onError = (error: unknown) => ctx.ui.notify(`tf: ${message(error)}`, "warning");
    const onInfo = (text: string) => ctx.ui.notify(text, "info");
    const onConflict = async (pr: gh.ConflictedPullRequest) => {
      await startConflictResolver(pi, ctx.cwd, pr);
      onInfo(`tf: #${pr.number} has conflicts: started the conflict resolver`);
    };
    pullRequestEvents(ctx.cwd, signIn(ctx), onError, onInfo, onConflict)
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
    for (const agent of agents) agent.dispose();
    agents = [];
    await events?.stop();
    events = undefined;
    pane.dispose();
  });
}
