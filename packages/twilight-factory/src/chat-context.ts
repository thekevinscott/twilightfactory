import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as gh from "twilight-gh";
import { Type } from "typebox";

type Octokit = ReturnType<typeof gh.client>;

export interface ChatContextOptions {
  repo: (cwd: string) => Promise<string>;
  github: () => Promise<Octokit>;
  state: () => string | undefined;
}

export const TOOLS = ["tf_state", "tf_pull_requests", "tf_issues", "tf_ci_runs"] as const;

const about = (cwd: string, repo: string) =>
  [
    "This Pi session runs inside tf (twilight factory), a Pi wrapper that runs a CI state machine on this repository:",
    `it decides when to start the ${gh.WORKFLOW} workflow on main, tracks whether main is green, and turns on auto-merge for new pull requests.`,
    `Project directory: ${cwd}`,
    `GitHub repository: ${repo}`,
    `For live state call ${TOOLS.join(", ")}; each fetches from GitHub when called.`,
  ].join("\n");

const text = (lines: string[]) => ({ content: [{ type: "text" as const, text: lines.length > 0 ? lines.join("\n") : "none" }], details: {} });

export const chatContext = (pi: ExtensionAPI, { repo, github, state }: ChatContextOptions) => {
  let section: string | undefined;
  let repoName: Promise<string> | undefined;

  pi.on("session_start", async (_event, ctx) => {
    repoName = repo(ctx.cwd);
    section = about(ctx.cwd, await repoName.catch(error => `unknown (${(error as Error).message})`));
  });

  pi.on("before_agent_start", event => {
    if (section) { event.systemPromptOptions.sections.twilight_factory = section; }
  });

  const fetchTool = (name: (typeof TOOLS)[number], description: string, lines: (github: Octokit, repo: string) => Promise<string[]>) =>
    pi.registerTool({
      name,
      label: name,
      description,
      promptSnippet: description,
      parameters: Type.Object({}),
      execute: async (_id, _params, _signal, _onUpdate, ctx) => text(await lines(await github(), await (repoName ?? repo(ctx.cwd)))),
    });

  pi.registerTool({
    name: "tf_state",
    label: "tf_state",
    description: "The current state of tf's CI state machine, as shown in the footer.",
    promptSnippet: "The current state of tf's CI state machine",
    parameters: Type.Object({}),
    execute: async () => text([state() ?? "not known yet"]),
  });
  fetchTool("tf_pull_requests", "Open pull requests and the last few closed ones, one per line.", async (octokit, name) =>
    (await gh.pullRequestSummaries(octokit, name)).map(gh.pullRequestLine),
  );
  fetchTool("tf_issues", "Open issues (not pull requests), one per line.", async (octokit, name) =>
    (await gh.openIssues(octokit, name)).map(gh.issueLine),
  );
  fetchTool("tf_ci_runs", `Recent ${gh.WORKFLOW} runs on main, newest first: kind, status, conclusion, head, URL.`, async (octokit, name) =>
    (await gh.recentRuns(octokit, name)).map(gh.runLine),
  );
};
