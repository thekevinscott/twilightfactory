# twilight-gh

The GitHub calls twilightfactory needs, one function each, on Octokit. Every function takes a client from `client(token)` and the repo as `owner/name`.

| Function | Call |
|---|---|
| `lastRun(github, repo)` | newest run of `tests.yml` on main |
| `lastMeasuredRun(github, repo)` | newest of the last 100 runs whose title has `(measured)` |
| `head(github, repo)` | `GET /repos/{repo}/commits/HEAD` |
| `openRedIssue(github, repo)` | open issues labelled `red` |
| `blockedPullRequests(github, repo)` | open pull requests whose `Main is green` check failed (GraphQL) |
| `startRun(github, repo, kind)` | dispatch `tests.yml` on main with `kind=plain\|measured` |
| `fileIssue(github, repo, run)` | create an issue labelled `red` |
| `rerunCheck(github, repo, runId)` | re-run the failed jobs of a run |
| `confirmFix(github, repo)` | dispatch `tests.yml` with the kind of the newest red run, for the fixing agent |

The workflow must set `run-name: Tests (${{ inputs.kind }})` so measured runs can be told apart.

## Events

`eventSource` turns GitHub changes into events. Each source can take webhooks, poll, or both. Both routes feed one in-process queue ([p-queue](https://github.com/sindresorhus/p-queue), one handler at a time, in arrival order), so a webhook that never arrives is caught by the next poll.

```ts
const pulls = defineSource({
  type: "pull_request.opened",
  webhook: { event: "pull_request.opened", changes: ({ payload }) => [{ key: String(payload.pull_request.id), data: payload.pull_request }] },
  poll: async ({ get, since }) => (await get<Pull[]>("GET /repos/{owner}/{repo}/pulls", { state: "open" })).map(pull => ({ key: String(pull.id), data: pull })),
});

const events = eventSource({ github, repo, sources: [pulls], secret });
events.on("pull_request.opened", event => { /* event.key, event.data, event.via */ });
await events.start();                                 // poll now, then every `interval` ms (default 60s)
await events.serve({ smee: "https://smee.io/abc" });  // optional: take webhooks
await events.stop();                                  // stop polling and serving, drain the queue
```

- Dedupe: an event fires once per `type` + `key`. Build the key from the resource (id, plus `updated_at` when updates matter) so webhook and poll produce the same one. The last 10,000 keys are kept in memory (`remember`), so a restart can fire a change again.
- Polling: `get` sends the last `ETag` back as `If-None-Match`. An unchanged response is a 304, which does not count against the rate limit, and returns the cached data. `since` is when the source's last successful poll started.
- Webhooks: signatures are checked by [@octokit/webhooks](https://github.com/octokit/webhooks.js) against `secret`. `serve` starts a server on 127.0.0.1 and, given a smee.io channel, forwards its deliveries there with [smee-client](https://github.com/probot/smee-client). The repository needs a webhook pointing at that channel with the same secret. `receive` takes a delivery directly.
