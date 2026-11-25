```typescript
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, onTestFinished } from 'vitest';
import { test } from 'curtaincall/vitest';

const DISPATCH = 'https://api.github.com/repos/thekevinscott/twilightfactory/actions/workflows/tests.yml/dispatches';

type Entry = { method: string; url: string; body: string };

// The proxy POSTs each request tf makes to this server as it arrives.
const requests = async () => {
  const seen: Entry[] = [];
  const waiting: [(entry: Entry) => boolean, (entry: Entry) => void][] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.end();
      const entry: Entry = JSON.parse(body);
      seen.push(entry);
      for (const [match, resolve] of waiting) if (match(entry)) resolve(entry);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve));
  onTestFinished(() => { server.close(); });
  return {
    port: (server.address() as AddressInfo).port,
    next: (match: (entry: Entry) => boolean) => new Promise<Entry>(resolve => {
      const found = seen.find(match);
      if (found) resolve(found);
      else waiting.push([match, resolve]);
    }),
  };
};

const start = async (terminal, fixture: string) => {
  const proxy = await requests();
  terminal(cli.join(' '), {
    env: { GH_TOKEN: 'gho_run', HTTPS_PROXY: `http://${encodeURIComponent(`tests/fixtures/${fixture}`)}:callback.${proxy.port}@proxy:8080` },
  });
  return proxy;
};
```

# It starts a plain run on main when a plain run is due

The fixture's measured run is dated 2099 so it always counts as within the last day.

```typescript
test(title, async ({ terminal }) => {
  const proxy = await start(terminal, 'run/go-plain');
  const dispatch = await proxy.next(entry => entry.method === 'POST' && entry.url === DISPATCH);
  expect(JSON.parse(dispatch.body)).toEqual({ ref: 'main', inputs: { kind: 'plain' } });
});
```
