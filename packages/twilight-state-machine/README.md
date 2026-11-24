# twilight-state-machine

`twilightfactory-state-machine` with twilightfactory's states. The caller supplies how to fetch the last CI run and the head commit, and one action per state.

```typescript
import { Stop, twilightStateMachine } from 'twilight-state-machine';

await twilightStateMachine(inputs, { GO_PLAIN: runTests, GO_MEASURED: runMeasured, STOP: Stop });
```

`inputs` is `{ lastRun, head, lastMeasuredRun }`, each an async function, called only when the state depends on it. `lastRun` returns the latest run of either kind, one entry of `gh run list --json status,conclusion,createdAt,headSha`, or `null`. `head` returns the head commit of the default branch, and is called only when the last run passed an hour ago or more. `lastMeasuredRun` returns the latest speed and memory run, and is called only when there are new commits. A measured run replaces the plain run.

| Last run | State |
|---|---|
| none | `GO_MEASURED` |
| not completed | `STOP` |
| failed | `STOP` |
| passed less than an hour ago | `STOP` |
| passed an hour ago or more, no new commits | `STOP` |
| passed an hour ago or more, new commits, measured run under a day old | `GO_PLAIN` |
| passed an hour ago or more, new commits, no measured run in a day or more | `GO_MEASURED` |
