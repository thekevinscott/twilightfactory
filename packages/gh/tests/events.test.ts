import { Webhooks } from "@octokit/webhooks";
import { expect, test, vi } from "vitest";
import * as gh from "../src/index.js";

const repo = "owner/name";
const secret = "shh";
const route = "GET /repos/{owner}/{repo}/pulls";
const pullsUrl = "https://api.github.com/repos/owner/name/pulls?state=all";

interface Pull {
  id: number;
  updated_at: string;
}

// Answers every request with the current `pulls`, and with 304 when the client sends back the etag of unchanged data.
const fakeGitHub = () => {
  const state = { pulls: [] as Pull[] };
  const requests: { url: string; ifNoneMatch: string | null }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const etag = `"${JSON.stringify(state.pulls).length}-${state.pulls.length}"`;
    requests.push({ url, ifNoneMatch: headers.get("if-none-match") });
    if (headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(JSON.stringify(state.pulls), { status: 200, headers: { "content-type": "application/json", etag } });
  };
  return { github: gh.client("token", { request: { fetch } }), state, requests };
};

const pullSource = gh.defineSource({
  type: "pull",
  webhook: {
    event: "pull_request",
    changes: ({ payload }) => [{ key: `${payload.pull_request.id}:${payload.pull_request.updated_at}`, data: payload.pull_request.id }],
  },
  poll: async ({ get }) =>
    (await get<Pull[]>(route, { state: "all" })).map(pull => ({ key: `${pull.id}:${pull.updated_at}`, data: pull.id })),
});

const delivery = async (id: string, pull: Pull) => {
  const payload = JSON.stringify({ action: "opened", pull_request: pull });
  return { id, name: "pull_request", payload, signature: await new Webhooks({ secret }).sign(payload) };
};

const setup = (options: Partial<gh.EventSourceOptions> = {}) => {
  const fake = fakeGitHub();
  const events = gh.eventSource({ github: fake.github, repo, secret, sources: [pullSource], interval: 60_000, ...options });
  const seen: gh.GitHubEvent[] = [];
  events.on("pull", event => void seen.push(event));
  return { ...fake, events, seen };
};

test("a poll fires each change to the handlers of its type", async () => {
  const { events, state, seen, requests } = setup();
  state.pulls = [{ id: 1, updated_at: "t1" }];
  await events.start();
  await events.stop();
  expect(seen).toEqual([{ type: "pull", key: "1:t1", data: 1, via: "poll" }]);
  expect(requests[0]?.url).toBe(pullsUrl);
});

test("a webhook fires its change", async () => {
  const { events, seen } = setup();
  await events.receive(await delivery("d1", { id: 2, updated_at: "t2" }));
  await events.stop();
  expect(seen).toEqual([{ type: "pull", key: "2:t2", data: 2, via: "webhook" }]);
});

test("a change seen by webhook and then by poll fires once", async () => {
  const { events, state, seen } = setup();
  await events.receive(await delivery("d1", { id: 3, updated_at: "t3" }));
  state.pulls = [{ id: 3, updated_at: "t3" }];
  await events.start();
  await events.stop();
  expect(seen).toEqual([{ type: "pull", key: "3:t3", data: 3, via: "webhook" }]);
});

test("a change seen by poll and then by webhook fires once", async () => {
  const { events, state, seen } = setup();
  state.pulls = [{ id: 4, updated_at: "t4" }];
  await events.start();
  await events.receive(await delivery("d1", { id: 4, updated_at: "t4" }));
  await events.stop();
  expect(seen.map(event => event.via)).toEqual(["poll"]);
});

test("a redelivered webhook fires once", async () => {
  const { events, seen } = setup();
  await events.receive(await delivery("d1", { id: 5, updated_at: "t5" }));
  await events.receive(await delivery("d1", { id: 5, updated_at: "t5" }));
  await events.stop();
  expect(seen).toHaveLength(1);
});

test("a later update to the same resource fires again", async () => {
  const { events, seen } = setup();
  await events.receive(await delivery("d1", { id: 6, updated_at: "t1" }));
  await events.receive(await delivery("d2", { id: 6, updated_at: "t2" }));
  await events.stop();
  expect(seen.map(event => event.key)).toEqual(["6:t1", "6:t2"]);
});

test("a change the webhook missed is caught by the next poll", async () => {
  const { events, state, seen } = setup({ interval: 5 });
  await events.start();
  state.pulls = [{ id: 7, updated_at: "t7" }];
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  await events.stop();
  expect(seen[0]).toMatchObject({ key: "7:t7", via: "poll" });
});

test("handlers run one at a time in arrival order", async () => {
  const { events } = setup();
  const log: string[] = [];
  events.on("pull", async event => {
    log.push(`start ${event.key}`);
    await new Promise(resolve => setTimeout(resolve, event.data === 8 ? 20 : 0));
    log.push(`end ${event.key}`);
  });
  await events.receive(await delivery("d1", { id: 8, updated_at: "t" }));
  await events.receive(await delivery("d2", { id: 9, updated_at: "t" }));
  await events.stop();
  expect(log).toEqual(["start 8:t", "end 8:t", "start 9:t", "end 9:t"]);
});

test("an unchanged poll sends the etag back and fires nothing new", async () => {
  const { events, state, seen, requests } = setup({ interval: 5 });
  state.pulls = [{ id: 10, updated_at: "t" }];
  await events.start();
  await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
  await events.stop();
  expect(requests[0]?.ifNoneMatch).toBeNull();
  expect(requests[1]?.ifNoneMatch).not.toBeNull();
  expect(seen).toHaveLength(1);
});

test("a poll gets the time the previous successful poll started", async () => {
  const sinces: (Date | null)[] = [];
  const { events } = setup({
    interval: 5,
    sources: [gh.defineSource({ type: "pull", poll: async ({ since }) => (sinces.push(since), []) })],
  });
  const before = new Date();
  await events.start();
  await vi.waitFor(() => expect(sinces.length).toBeGreaterThanOrEqual(2));
  await events.stop();
  expect(sinces[0]).toBeNull();
  expect(sinces[1]!.getTime()).toBeGreaterThanOrEqual(before.getTime());
});

test("a webhook with a bad signature is rejected and fires nothing", async () => {
  const { events, seen } = setup();
  const good = await delivery("d1", { id: 11, updated_at: "t" });
  await expect(events.receive({ ...good, signature: "sha256=00" })).rejects.toThrow();
  await events.stop();
  expect(seen).toEqual([]);
});

test("a failing handler is reported and later events still run", async () => {
  const onError = vi.fn();
  const { events, seen } = setup({ onError });
  events.on("pull", event => {
    if (event.data === 12) throw new Error("boom");
  });
  await events.receive(await delivery("d1", { id: 12, updated_at: "t" }));
  await events.receive(await delivery("d2", { id: 13, updated_at: "t" }));
  await events.stop();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }), expect.objectContaining({ key: "12:t" }));
  expect(seen).toHaveLength(2);
});

test("serve takes signed webhooks over HTTP", async () => {
  const { events, seen } = setup();
  const { url } = await events.serve({ port: 0 });
  const { id, name, payload, signature } = await delivery("d1", { id: 14, updated_at: "t" });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-delivery": id, "x-github-event": name, "x-hub-signature-256": signature },
    body: payload,
  });
  await events.stop();
  expect(response.status).toBe(200);
  expect(seen).toEqual([{ type: "pull", key: "14:t", data: 14, via: "webhook" }]);
});

test("a source without a secret still polls", async () => {
  const { events, state, seen } = setup({ secret: undefined });
  state.pulls = [{ id: 15, updated_at: "t" }];
  await events.start();
  await events.stop();
  expect(seen).toEqual([{ type: "pull", key: "15:t", data: 15, via: "poll" }]);
});

test("a source without a secret refuses webhooks", async () => {
  const { events, seen } = setup({ secret: undefined });
  await expect(events.receive(await delivery("d1", { id: 16, updated_at: "t" }))).rejects.toThrow("needs a webhook secret");
  await expect(events.serve({ port: 0 })).rejects.toThrow("needs a webhook secret");
  await events.stop();
  expect(seen).toEqual([]);
});
