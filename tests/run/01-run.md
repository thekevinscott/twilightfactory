```typescript
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const DISPATCH = 'https://api.github.com/repos/thekevinscott/twilightfactory/actions/workflows/tests.yml/dispatches';

const start = (terminal) => {
  const log = randomUUID().replaceAll('-', '');
  const term = terminal(cli.join(' '), {
    env: { GH_TOKEN: 'gho_run', HTTPS_PROXY: `http://${encodeURIComponent('tests/fixtures/run/dispatch')}:${log}@proxy:8080` },
  });
  return { term, log };
};

const dispatches = (log: string) => {
  const file = path.join(process.env.PROXY_REQUESTS!, `${log}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(entry => entry.method === 'POST' && entry.url === DISPATCH)
    .map(entry => JSON.parse(entry.body).inputs.kind);
};
```

# It starts a plain tests run with /tests

```typescript
test(title, async ({ terminal }) => {
  const { term, log } = start(terminal);
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible({ timeout: 30000 });
  term.submit('/tests');
  await expectTerminal(term.getByText('Started a plain tests run')).toBeVisible({ timeout: 10000 });
  expect(dispatches(log)).toEqual(['plain']);
}, 60000);
```

# It starts a measured tests run with /tests measured

```typescript
test(title, async ({ terminal }) => {
  const { term, log } = start(terminal);
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible({ timeout: 30000 });
  term.submit('/tests measured');
  await expectTerminal(term.getByText('Started a measured tests run')).toBeVisible({ timeout: 10000 });
  expect(dispatches(log)).toEqual(['measured']);
}, 60000);
```
