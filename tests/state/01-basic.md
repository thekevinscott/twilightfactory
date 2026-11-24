```typescript
import { expect, test } from 'vitest';
import { twilightStateMachine, type Inputs } from 'twilight-state-machine';
const never = () => { throw new Error('not fetched'); };
```

# It has never run

```typescript
test(title, async () => {
  const inputs: Inputs = {
    lastRun: async () => null,
    lastMeasuredRun: never,
    head: never,
    openRedIssue: never,
    blockedPullRequests: never,
  };
  expect(await twilightStateMachine(inputs)).toEqual('GO_MEASURED');
});
```
