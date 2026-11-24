```typescript
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';
const border = /^─+ \S.*\S ─$/;
```

# It shows the state in the input box's top border

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '));
  await expectTerminal(term.getByText(border, { full: true })).toBeVisible({ timeout: 30000 });
}, 60000);
```

# It adds no status line under Pi's footer

```typescript
test(title, async ({ terminal }) => {
  const term = terminal(cli.join(' '));
  await expectTerminal(term.getByText(border, { full: true })).toBeVisible({ timeout: 30000 });
  await expectTerminal(term.getByText('tf:')).notToBeVisible();
}, 60000);
```
