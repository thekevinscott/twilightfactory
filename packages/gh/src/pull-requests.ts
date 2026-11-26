import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { defineSource, type PollContext } from "./events.js";

export interface PullRequest {
  number: number;
  nodeId: string;
  title: string;
  url: string;
  draft: boolean;
  author: string;
  head: string;
  base: string;
}

export interface ClosedPullRequest extends PullRequest {
  merged: boolean;
}

// The fields both a webhook payload and a list item carry.
interface Item {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  html_url: string;
  draft?: boolean;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

const PER_PAGE = 100;
// Slack for clock skew between this machine and GitHub, which stamps whole seconds. Dedupe absorbs the overlap.
const SKEW = 60_000;

const pullRequest = (item: Item): PullRequest => ({
  number: item.number,
  nodeId: item.node_id,
  title: item.title,
  url: item.html_url,
  draft: item.draft ?? false,
  author: item.user?.login ?? "",
  head: item.head.ref,
  base: item.base.ref,
});

const closed = (item: Item): ClosedPullRequest => ({ ...pullRequest(item), merged: item.merged_at !== null });

const openedKey = (item: Item) => `${item.number}`;
const closedKey = (item: Item) => `${item.number}:${item.closed_at}`;
// An edit leaves no timestamp of its own (updated_at moves on any activity), so the key is the edited content.
const editedKey = (item: Item) =>
  `${item.number}:${createHash("sha1").update(JSON.stringify([item.title, item.body, item.base.ref])).digest("hex").slice(0, 12)}`;

const after = (time: string | null, since: Date) => time !== null && Date.parse(time) >= since.getTime() - SKEW;

// Newest-updated first; stops at the first page that reaches back past `since`, or after one page with no `since`.
const recent = async ({ get }: PollContext, since: Date | null): Promise<Item[]> => {
  const items: Item[] = [];
  for (let page = 1; ; page++) {
    const batch = await get<Item[]>("GET /repos/{owner}/{repo}/pulls", {
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: PER_PAGE,
      page,
    });
    items.push(...batch);
    if (since === null || batch.length < PER_PAGE || !after(batch.at(-1)!.updated_at, since)) return items;
  }
};

// The first poll after a start fires nothing. Dedupe lives in memory, so firing on it would replay every
// pull request on each restart; changes made while nothing was running are missed instead.

export const pullRequestOpened = () =>
  defineSource({
    type: "pull_request.opened",
    webhook: {
      event: "pull_request.opened",
      changes: ({ payload }) => [{ key: openedKey(payload.pull_request), data: pullRequest(payload.pull_request) }],
    },
    poll: async context => {
      const { since } = context;
      if (since === null) return [];
      return (await recent(context, since))
        .filter(item => after(item.created_at, since))
        .map(item => ({ key: openedKey(item), data: pullRequest(item) }));
    },
  });

export const pullRequestClosed = () =>
  defineSource({
    type: "pull_request.closed",
    webhook: {
      event: "pull_request.closed",
      changes: ({ payload }) => [{ key: closedKey(payload.pull_request), data: closed(payload.pull_request) }],
    },
    poll: async context => {
      const { since } = context;
      if (since === null) return [];
      return (await recent(context, since))
        .filter(item => after(item.closed_at, since))
        .map(item => ({ key: closedKey(item), data: closed(item) }));
    },
  });

// A poll sees an edit as a change in title, body or base since the last poll, so it keeps the last content it saw.
export const pullRequestEdited = () => {
  const last = new Map<number, string>();
  return defineSource({
    type: "pull_request.edited",
    webhook: {
      event: "pull_request.edited",
      changes: ({ payload }) => [{ key: editedKey(payload.pull_request), data: pullRequest(payload.pull_request) }],
    },
    poll: async context => {
      const changes = [];
      for (const item of await recent(context, context.since)) {
        const key = editedKey(item);
        const previous = last.get(item.number);
        last.set(item.number, key);
        if (previous !== undefined && previous !== key) changes.push({ key, data: pullRequest(item) });
      }
      return changes;
    },
  });
};

const enableAutoMergeMutation = `
mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
    pullRequest { number }
  }
}`;

export type AutoMerge = "enabled" | "draft" | "already-enabled";

// GitHub refuses auto-merge on drafts, so a draft is skipped rather than sent.
export const enableAutoMerge = async (
  github: Octokit,
  { nodeId, draft }: Pick<PullRequest, "nodeId" | "draft">,
): Promise<AutoMerge> => {
  if (draft) return "draft";
  try {
    await github.graphql(enableAutoMergeMutation, { pullRequestId: nodeId, mergeMethod: "MERGE" });
    return "enabled";
  } catch (error) {
    if (/already/i.test((error as Error).message)) return "already-enabled";
    throw error;
  }
};

export interface ConflictedPullRequest extends PullRequest {
  headSha: string;
}

interface Detail extends Item {
  head: { ref: string; sha: string };
  mergeable_state: string;
}

export interface ConflictOptions {
  // Reads after the first while GitHub still reports mergeability as `unknown`, and the wait between them.
  retries?: number;
  delay?: number;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The list endpoint and webhook payloads omit mergeability, so each candidate is fetched; ETags make unchanged ones free.
// Keyed by head, so a pull request fires once per push and an agent working on it is not started again.
// No event says a pull request became conflicted: a push to the default branch or a merge can conflict any open one,
// a push to a pull request that one. Mergeability reads `unknown` until GitHub computes it, so a webhook reads again.
export const pullRequestConflicted = ({ retries = 5, delay = 2_000 }: ConflictOptions = {}) => {
  const check = async ({ get }: PollContext, number: number, attempts: number) => {
    let item = await get<Detail>("GET /repos/{owner}/{repo}/pulls/{pull_number}", { pull_number: number });
    for (let attempt = 0; item.mergeable_state === "unknown" && attempt < attempts; attempt++) {
      await wait(delay);
      item = await get<Detail>("GET /repos/{owner}/{repo}/pulls/{pull_number}", { pull_number: number });
    }
    if (item.draft || item.mergeable_state !== "dirty") return [];
    return [{ key: `${number}:${item.head.sha}`, data: { ...pullRequest(item), headSha: item.head.sha } }];
  };

  const checkOpen = async (context: PollContext, attempts: number) => {
    const open = await context.get<Item[]>("GET /repos/{owner}/{repo}/pulls", { state: "open", per_page: PER_PAGE });
    const changes = [];
    for (const { number, draft } of open) if (!draft) changes.push(...(await check(context, number, attempts)));
    return changes;
  };

  return defineSource({
    type: "pull_request.conflicted",
    webhook: {
      event: ["push", "pull_request.closed", "pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
      changes: async (webhook, context) => {
        if (webhook.name === "push") {
          const { ref, repository } = webhook.payload;
          return ref === `refs/heads/${repository.default_branch}` ? checkOpen(context, retries) : [];
        }
        const { action, pull_request } = webhook.payload;
        if (action === "closed") return pull_request.merged ? checkOpen(context, retries) : [];
        return pull_request.draft ? [] : check(context, pull_request.number, retries);
      },
    },
    // The next poll reads an `unknown` pull request again, so a poll does not wait on it.
    poll: context => checkOpen(context, 0),
  });
};
