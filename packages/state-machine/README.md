# twilightfactory-state-machine

State and actions are async functions. Every argument after `actions` is passed to both. The caller owns all state logic.

```typescript
import { stateMachine, Stop } from 'twilightfactory-state-machine';

const actions = { advice_missing: writeAdvice, unscored: scoreAdvice, done: Stop };
await stateMachine(readState, actions, turn);
```

1. Call `state(...args)` to read the current state name.
2. Look up its action and run it with the same arguments to completion, or return if it is `Stop`.
3. Repeat from step 1.

An unknown state throws.
Actions must change what `state(...args)` reads, or the same action runs again.

Ported from the Python `state-machine` package in surprisals-experiment.
