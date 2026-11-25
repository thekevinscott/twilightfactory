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
  await expectTerminal(term.getByText(status)).toBeVisible();
  return term;
};
```

# It leaves the input box border plain

```typescript
test(title, async ({ terminal }) => {
  const term = await shows(terminal, 'state/tests-due', /🔵\s+tests due/);
  await expectTerminal(term.getByText(/^─+ \S.*\S ─$/, { full: true })).notToBeVisible();
});
```

# It replaces Pi's footer with a single line

```typescript
test(title, async ({ terminal }) => {
  const term = await shows(terminal, 'state/tests-due', /🔵\s+tests due/);
  await expectTerminal(term.getByText('(auto)')).notToBeVisible();
});
```

# It leaves the git branch out of the footer

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '), {
    cols: 300,
    env: { GH_TOKEN: 'gho_footer', HTTPS_PROXY: `http://${encodeURIComponent('tests/fixtures/state/tests-due')}:footer@proxy:8080` },
  });
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible();
  await expectTerminal(term.getByText(/🔵.*\(\S+\)/)).notToBeVisible();
});
```

# It starts Pi on Claude through pi-claude-bridge

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '), {
    cols: 300,
    env: { GH_TOKEN: 'gho_footer', HTTPS_PROXY: `http://${encodeURIComponent('tests/fixtures/state/tests-due')}:footer@proxy:8080` },
  });
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible();
  await expectTerminal(term.getByText('claude-opus-5-5')).toBeVisible();
});
```

# It hides Pi's startup header and resource lists

```typescript
test(title, async ({ terminal }) => {
  const term = await shows(terminal, 'state/tests-due', /🔵\s+tests due/);
  await expectTerminal(term.getByText('Pi can explain its own features')).notToBeVisible();
  await expectTerminal(term.getByText('[Extensions]')).notToBeVisible();
});
```

# It shows the whole directory when the terminal is wide

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '), {
    cols: 300,
    env: { GH_TOKEN: 'gho_footer', HTTPS_PROXY: `http://${encodeURIComponent('tests/fixtures/state/tests-due')}:footer@proxy:8080` },
  });
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible();
  await expectTerminal(term.getByText(process.cwd().replace(process.env.HOME ?? '\0', '~'))).toBeVisible();
  await expectTerminal(term.getByText('...')).notToBeVisible();
});
```

# It cuts the directory from the left when the terminal is narrow

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '), {
    cols: 50,
    env: { GH_TOKEN: 'gho_footer', HTTPS_PROXY: `http://${encodeURIComponent('tests/fixtures/state/tests-due')}:footer@proxy:8080` },
  });
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible();
  await expectTerminal(term.getByText(new RegExp(`\\.\\.\\.\\S*/${path.basename(process.cwd())} `))).toBeVisible();
});
```
