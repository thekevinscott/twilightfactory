# twilight-state-machine

`twilightfactory-state-machine` with twilightfactory's states. The caller supplies how to fetch the last CI run and the head commit, and one action per state.

```typescript
import { Stop, twilightStateMachine } from 'twilight-state-machine';

await twilightStateMachine(inputs, { GO: start, STOP: Stop });
```

`inputs` is `{ lastRun, head }`, each an async function, called only when the state depends on it. `lastRun` returns one entry of `gh run list --json status,conclusion,createdAt,headSha` or `null`. `head` returns the head commit of the default branch, and is called only when the last run passed an hour ago or more.

| Last run | State |
|---|---|
| none | `GO` |
| not completed | `STOP` |
| failed | `STOP` |
| passed less than an hour ago | `STOP` |
| passed an hour ago or more, no new commits | `STOP` |
| passed an hour ago or more, new commits | `GO` |
