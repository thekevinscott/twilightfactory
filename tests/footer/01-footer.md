```typescript
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const start = (terminal, fixture: string) =>
  terminal(cli.join(' '), {
    env: { HTTPS_PROXY: `http://${encodeURIComponent(`tests/fixtures/footer/${fixture}`)}:footer@proxy:8080`, GH_TOKEN: 'gho_footer' },
  });
```

# It shows a dot and a short status in the footer

```typescript
test(title, async ({ terminal }) => {
  const term = start(terminal, 'tests-due');
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible({ timeout: 30000 });
}, 60000);
```

# It leaves the input box border plain

```typescript
test(title, async ({ terminal }) => {
  const term = start(terminal, 'tests-due');
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible({ timeout: 30000 });
  await expectTerminal(term.getByText(/^─+ \S.*\S ─$/, { full: true })).notToBeVisible();
}, 60000);
```

# It replaces Pi's footer with a single line

```typescript
test(title, async ({ terminal }) => {
  const term = start(terminal, 'tests-due');
  await expectTerminal(term.getByText(/🔵\s+tests due/)).toBeVisible({ timeout: 30000 });
  await expectTerminal(term.getByText('(auto)')).notToBeVisible();
}, 60000);
```
