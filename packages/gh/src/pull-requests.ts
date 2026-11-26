import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { type Change, defineSource, type PollContext } from "./events.js";

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
  for (let page = 1; ; page += 1) {
    const batch = await get<Item[]>("GET /repos/{owner}/{repo}/pulls", {
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: PER_PAGE,
      page,
    });
    items.push(...batch);
    if (since === null || batch.length < PER_PAGE || !after(batch.at(-1)!.updated_at, since)) { return items; }
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
      if (since === null) { return []; }
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
      if (since === null) { return []; }
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
      const changes: Change<PullRequest>[] = [];
      const items = await recent(context, context.since);
      for (const item of items) {
        const key = editedKey(item);
        const previous = last.get(item.number);
        last.set(item.number, key);
        if (previous !== undefined && previous !== key) { changes.push({ key, data: pullRequest(item) }); }
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
  if (draft) { return "draft"; }
  try {
    await github.graphql(enableAutoMergeMutation, { pullRequestId: nodeId, mergeMethod: "MERGE" });
    return "enabled";
  } catch (error) {
    if (/already/i.test((error as Error).message)) { return "already-enabled"; }
    throw error;
  }
};
