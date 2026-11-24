# twilight-state-machine

Decides what twilightfactory does next. The caller supplies how to fetch each input; the machine returns one state. The caller acts on it and exits; the next tick calls the machine again.

```typescript
import { twilightStateMachine } from 'twilight-state-machine';

const state = await twilightStateMachine(inputs); // STOP | GO_PLAIN | GO_MEASURED | PUSH_TAG | PUSH_RESULTS
```

`inputs` is `{ lastRun, lastGreenTag, lastMeasuredRun, lastResults, head }`, each an async function, called only when the state depends on it. `lastRun` returns the latest run of either kind, one entry of `gh run list --json status,conclusion,createdAt,headSha`, or `null`. `lastGreenTag` returns the commit of the newest green tag or `null`, and is called only when the last run passed. `lastResults` returns the commit of the newest stored speed and memory results or `null`, and is called only when the last run is a passed measured run. Where results are stored is the caller's concern. `head` returns the head commit of the default branch, and is called only when the last run passed an hour ago or more. `lastMeasuredRun` returns the latest speed and memory run, fetched at most once per state. A measured run replaces the plain run.

| Last run | State |
|---|---|
| none | `GO_MEASURED` |
| not completed | `STOP` |
| failed | `STOP` |
| passed, and its commit has no green tag | `PUSH_TAG` |
| passed measured run, results not stored | `PUSH_RESULTS` |
| passed less than an hour ago | `STOP` |
| passed an hour ago or more, no new commits | `STOP` |
| passed an hour ago or more, new commits, measured run under a day old | `GO_PLAIN` |
| passed an hour ago or more, new commits, no measured run in a day or more | `GO_MEASURED` |
