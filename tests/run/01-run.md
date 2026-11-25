```typescript
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from 'vitest';
import { test } from 'curtaincall/vitest';

const DISPATCH = 'https://api.github.com/repos/thekevinscott/twilightfactory/actions/workflows/tests.yml/dispatches';

const start = (terminal, fixture: string) => {
  const log = randomUUID().replaceAll('-', '');
  terminal(cli.join(' '), {
    env: { GH_TOKEN: 'gho_run', HTTPS_PROXY: `http://${encodeURIComponent(`tests/fixtures/${fixture}`)}:${log}@proxy:8080` },
  });
  return log;
};

const dispatches = (log: string) => {
  const file = path.join(process.env.PROXY_REQUESTS!, `${log}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(entry => entry.method === 'POST' && entry.url === DISPATCH)
    .map(entry => JSON.parse(entry.body));
};
```

# It starts a plain run on main when a plain run is due

The fixture's measured run is dated 2099 so it always counts as within the last day.

```typescript
test(title, async ({ terminal }) => {
  const log = start(terminal, 'run/go-plain');
  await expect.poll(() => dispatches(log)).toEqual([{ ref: 'main', inputs: { kind: 'plain' } }]);
});
```
