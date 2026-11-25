```typescript
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';
```

# It starts a plain run on main when a plain run is due

The fixture's measured run is dated 2099 so it always counts as within the last day.

```typescript
test(title, async ({ terminal }) => {
  const requests = await proxyRequests();
  startTf(terminal, cli, { fixture: 'run/go-plain', log: requests.log, env: { GH_TOKEN: 'gho_run' } });
  const dispatch = await requests.next(({ method, url }) => method === 'POST' && url.endsWith('/actions/workflows/tests.yml/dispatches'));
  expect(JSON.parse(dispatch.body as string)).toEqual({ ref: 'main', inputs: { kind: 'plain' } });
});
```
