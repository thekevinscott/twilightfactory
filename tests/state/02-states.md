```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const start = (terminal, fixture: string, env: Record<string, string> = { GH_TOKEN: 'gho_footer' }) =>
  terminal(cli.join(' '), {
    env: { HTTPS_PROXY: `http://${encodeURIComponent(`tests/fixtures/${fixture}`)}:footer@proxy:8080`, ...env },
  });

const shows = async (terminal, fixture: string, status: RegExp, env?: Record<string, string>) => {
  const term = start(terminal, fixture, env);
  await expectTerminal(term.getByText(status)).toBeVisible({ timeout: 30000 });
  return term;
};
```

# It shows a blue dot when tests are due

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/tests-due', /🔵\s+tests due/), 60000);
```

# It shows a white dot when the repo has no tests workflow

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/not-set-up', /⚪\s+not set up/), 60000);
```

# It shows a white dot while a run is in progress

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/waiting', /⚪\s+waiting/), 60000);
```

# It shows a red dot when the last run failed

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/red', /🔴\s+red/), 60000);
```

# It shows a yellow dot when a pull request is blocked

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/prs-blocked', /🟡\s+PRs blocked/), 60000);
```

# It shows a yellow dot while waiting for GitHub sign-in

```typescript
test(title, ({ terminal }) =>
  shows(terminal, 'token/sign-in-pending', /🟡\s+sign in to GitHub/, {
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), 'tf-config-')),
    GH_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'tf-gh-')),
    TF_GITHUB_CLIENT_ID: 'Iv1.fixtureclientid',
  }), 60000);
```

# It shows a red dot and the error when GitHub can't be reached

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/unreachable', /🔴\s+error: /), 60000);
```
