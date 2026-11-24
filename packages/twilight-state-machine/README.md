# twilight-state-machine

Decides what twilightfactory does next. The caller supplies how to fetch each input; the machine returns one state. The caller acts on it and exits; the next tick calls the machine again.

```typescript
import { twilightStateMachine } from 'twilight-state-machine';

const state = await twilightStateMachine(inputs); // STOP | GO_PLAIN | GO_MEASURED | RECHECK_PRS | FILE_ISSUE
```

`inputs` is `{ lastRun, openRedIssue, blockedPullRequests, lastMeasuredRun, head }`, each an async function, called only when the state depends on it. `lastRun` returns the latest run of either kind, one entry of `gh run list --json status,conclusion,createdAt,headSha`, or `null`. `head` returns the head commit of the default branch, and is called only when the last run passed an hour ago or more. `lastMeasuredRun` returns the latest speed and memory run. `openRedIssue` returns whether an issue for the red main branch is open, and is called only when the last run failed; FILE_ISSUE tells the caller to open one. `blockedPullRequests` returns how many open pull requests have a failed main-is-green check, and is called only when the last run passed; RECHECK_PRS tells the caller to re-run those checks. A measured run replaces the plain run. Everything is derived from GitHub; the machine needs no stored state.

| Last run | State |
|---|---|
| none | `GO_MEASURED` |
| in progress or queued | `STOP` |
| failed, no red issue open | `FILE_ISSUE` |
| failed, red issue open | `STOP` |
| passed, and an open pull request has a failed main-is-green check | `RECHECK_PRS` |
| passed less than an hour ago | `STOP` |
| passed an hour ago or more, no new commits | `STOP` |
| passed an hour ago or more, new commits, measured run under a day old | `GO_PLAIN` |
| passed an hour ago or more, new commits, no measured run in a day or more | `GO_MEASURED` |
