import type { Octokit } from "@octokit/rest";
import type { Run } from "./index.js";

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: string;
  head: string;
  state: "open" | "merged" | "closed";
}

export interface IssueSummary {
  number: number;
  title: string;
  url: string;
  labels: string[];
}

const split = (repo: string) => {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, repo: name };
};

const CLOSED_SHOWN = 5;

const prState = (pr: { closed_at: string | null; merged_at: string | null }): PullRequestSummary["state"] => {
  if (pr.closed_at === null) { return "open"; }
  return pr.merged_at === null ? "closed" : "merged";
};

export const pullRequestSummaries = async (github: Octokit, repo: string): Promise<PullRequestSummary[]> => {
  const [open, closed] = await Promise.all([
    github.rest.pulls.list({ ...split(repo), state: "open", per_page: 100 }),
    github.rest.pulls.list({ ...split(repo), state: "closed", sort: "updated", direction: "desc", per_page: CLOSED_SHOWN }),
  ]);
  return [...open.data.filter(pr => pr.closed_at === null), ...closed.data.filter(pr => pr.closed_at !== null)].map(pr => ({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    draft: pr.draft ?? false,
    author: pr.user?.login ?? "",
    head: pr.head.ref,
    state: prState(pr),
  }));
};

export const openIssues = async (github: Octokit, repo: string): Promise<IssueSummary[]> => {
  const { data } = await github.rest.issues.listForRepo({ ...split(repo), state: "open", per_page: 100 });
  return data
    .filter(issue => !issue.pull_request)
    .map(issue => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      labels: issue.labels.map(label => (typeof label === "string" ? label : (label.name ?? ""))).filter(Boolean),
    }));
};

export const pullRequestLine = (pr: PullRequestSummary): string =>
  [`#${pr.number}`, pr.state, ...(pr.draft ? ["draft"] : []), JSON.stringify(pr.title), `by ${pr.author}`, `from ${pr.head}`, pr.url].join(" ");

export const issueLine = (issue: IssueSummary): string =>
  [`#${issue.number}`, JSON.stringify(issue.title), ...(issue.labels.length > 0 ? [`[${issue.labels.join(", ")}]`] : []), issue.url].join(" ");

export const runLine = (run: Run): string =>
  [
    run.displayTitle.includes("(measured)") ? "measured" : "plain",
    run.status,
    ...(run.conclusion ? [run.conclusion] : []),
    run.headSha.slice(0, 7),
    run.createdAt,
    run.url,
  ].join(" ");
