```typescript
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const proxy = (fixture: string) => `http://${encodeURIComponent(`tests/fixtures/token/${fixture}`)}:x@proxy:8080`;

const fakeGh = (script: string) => {
  const bin = mkdtempSync(path.join(tmpdir(), 'tf-gh-'));
  writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\n${script}\n`);
  chmodSync(path.join(bin, 'gh'), 0o755);
  return `${bin}:${process.env.PATH}`;
};

const env = ({ fixture, gh, config = mkdtempSync(path.join(tmpdir(), 'tf-config-')), token = '' }: { fixture: string; gh: string; config?: string; token?: string }) => ({
  HTTPS_PROXY: proxy(fixture),
  GH_TOKEN: token,
  GITHUB_TOKEN: '',
  PATH: fakeGh(gh),
  XDG_CONFIG_HOME: config,
  TF_GITHUB_CLIENT_ID: 'Iv1.fixtureclientid',
});

const loggedIn = 'echo gho_fromgh000000000000000000000000000000';
const loggedOut = 'echo "You are not logged into any GitHub hosts." >&2; exit 1';
const signedInToken = 'gho_signedin0000000000000000000000000000';
```

# It uses the token from GH_TOKEN

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '), { env: env({ fixture: 'empty-runs', gh: loggedOut, token: 'gho_fromenv0000000000000000000000000000' }) });
  await expectTerminal(term.getByText(/GO_MEASURED/)).toBeVisible({ timeout: 10_000 });
}, 30_000);
```

# It uses gh's token when the environment has none

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '), { env: env({ fixture: 'empty-runs', gh: loggedIn }) });
  await expectTerminal(term.getByText(/GO_MEASURED/)).toBeVisible({ timeout: 10_000 });
}, 30_000);
```

# It asks to sign in when there is no token and gh is logged out

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '), { env: env({ fixture: 'sign-in', gh: loggedOut }) });
  await expectTerminal(term.getByText('WDJB-MJHT')).toBeVisible({ timeout: 10_000 });
  await expectTerminal(term.getByText('https://github.com/login/device')).toBeVisible();
}, 30_000);
```

# It saves the signed-in token and reuses it on the next start

```typescript
test(title, async ({ terminal }) => {
  const config = mkdtempSync(path.join(tmpdir(), 'tf-config-'));
  const first = terminal(cli.join(' '), { env: env({ fixture: 'sign-in', gh: loggedOut, config }) });
  await expectTerminal(first.getByText(/GO_MEASURED/)).toBeVisible({ timeout: 10_000 });

  const saved = readdirSync(path.join(config, 'twilightfactory'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));
  expect(saved.join('\n')).toContain(signedInToken);

  const second = terminal(cli.join(' '), { env: env({ fixture: 'empty-runs', gh: loggedOut, config }) });
  await expectTerminal(second.getByText(/GO_MEASURED/)).toBeVisible({ timeout: 10_000 });
  await expectTerminal(second.getByText('https://github.com/login/device')).notToBeVisible();
}, 30_000);
```
