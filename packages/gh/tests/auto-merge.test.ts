import { expect, test } from "vitest";
import * as gh from "../src/index.js";

type Request = { url: string; body: { query: string; variables: unknown } };

const fake = (response: unknown) => {
  const requests: Request[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { github: gh.client("token", { request: { fetch } }), requests };
};

const enabled = { data: { enablePullRequestAutoMerge: { pullRequest: { number: 7 } } } };
const failed = (message: string) => ({ data: { enablePullRequestAutoMerge: null }, errors: [{ type: "UNPROCESSABLE", message }] });

test("enableAutoMerge turns on auto-merge with a merge commit", async () => {
  const { github, requests } = fake(enabled);
  expect(await gh.enableAutoMerge(github, { nodeId: "PR_node7", draft: false })).toBe("enabled");
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe("https://api.github.com/graphql");
  expect(requests[0]!.body.query).toContain("enablePullRequestAutoMerge");
  expect(requests[0]!.body.variables).toEqual({ pullRequestId: "PR_node7", mergeMethod: "MERGE" });
});

test("enableAutoMerge skips a draft without asking GitHub", async () => {
  const { github, requests } = fake(enabled);
  expect(await gh.enableAutoMerge(github, { nodeId: "PR_node7", draft: true })).toBe("draft");
  expect(requests).toEqual([]);
});

test("enableAutoMerge treats auto-merge that is already on as done", async () => {
  const { github } = fake(failed("Pull request is already in auto merge state"));
  expect(await gh.enableAutoMerge(github, { nodeId: "PR_node7", draft: false })).toBe("already-enabled");
});

test("enableAutoMerge rejects when GitHub refuses", async () => {
  const { github } = fake(failed("Auto merge is not allowed for this repository"));
  await expect(gh.enableAutoMerge(github, { nodeId: "PR_node7", draft: false })).rejects.toThrow(/not allowed/);
});
