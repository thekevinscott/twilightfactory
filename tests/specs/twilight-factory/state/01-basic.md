```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'curtaincall/vitest';

const shows = (terminal, fixture: string, status: RegExp, env: Record<string, string> = { GH_TOKEN: 'gho_footer' }) =>
  waitForStatus(startTf(terminal, cli, { fixture, env }).term, status);
```

# It has never run

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/tests-due', /🔵\s+tests due/));
```

# It shows a white dot when the repo has no tests workflow

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/not-set-up', /⚪\s+not set up/));
```

# It shows a green dot while a run is in progress

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/quiet', /🟢\s+all quiet/));
```

# It shows a red dot when the last run failed

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/red', /🔴\s+red/));
```

# It shows a red dot while a red issue is open

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/fixing', /🔴\s+fixing/));
```

# It shows a yellow dot when a pull request is blocked

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/prs-blocked', /🟡\s+PRs blocked/));
```

# It shows a yellow dot while waiting for GitHub sign-in

```typescript
test(title, ({ terminal }) =>
  shows(terminal, 'token/sign-in-pending', /🟡\s+sign in to GitHub/, {
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), 'tf-config-')),
    GH_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'tf-gh-')),
    TF_GITHUB_CLIENT_ID: 'Iv1.fixtureclientid',
  }));
```

# It shows a red dot and the error when GitHub can't be reached

```typescript
test(title, ({ terminal }) => shows(terminal, 'state/unreachable', /🔴\s+error: /));
```
