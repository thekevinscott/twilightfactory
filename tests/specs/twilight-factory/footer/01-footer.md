```typescript
import path from 'node:path';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

const testsDue = (terminal, cols?: number) =>
  waitForStatus(startTf(terminal, cli, { fixture: 'state/tests-due', env: { GH_TOKEN: 'gho_footer' }, cols }).term, /🔵\s+tests due/);
```

# It leaves the input box border plain

```typescript
test(title, async ({ terminal }) => {
  const term = await testsDue(terminal);
  await expectTerminal(term.getByText(/^─+ \S.*\S ─$/, { full: true })).notToBeVisible();
});
```

# It replaces Pi's footer with a single line

```typescript
test(title, async ({ terminal }) => {
  const term = await testsDue(terminal);
  await expectTerminal(term.getByText('(auto)')).notToBeVisible();
});
```

# It leaves the git branch out of the footer

```typescript
test(title, async ({ terminal }) => {
  const term = await testsDue(terminal, 300);
  await expectTerminal(term.getByText(/🔵.*\(\S+\)/)).notToBeVisible();
});
```

# It starts Pi on Claude through pi-claude-bridge

```typescript
test(title, async ({ terminal }) => {
  const term = await testsDue(terminal, 300);
  await expectTerminal(term.getByText('claude-opus-5-5')).toBeVisible();
});
```

# It hides Pi's startup header and resource lists

```typescript
test(title, async ({ terminal }) => {
  const term = await testsDue(terminal);
  await expectTerminal(term.getByText('Pi can explain its own features')).notToBeVisible();
  await expectTerminal(term.getByText('[Extensions]')).notToBeVisible();
});
```

# It shows the whole directory when the terminal is wide

```typescript
test(title, async ({ terminal }) => {
  const term = await testsDue(terminal, 300);
  await expectTerminal(term.getByText(process.cwd().replace(process.env.HOME ?? '\0', '~'))).toBeVisible();
  await expectTerminal(term.getByText('...')).notToBeVisible();
});
```

# It cuts the directory from the left when the terminal is narrow

```typescript
test(title, async ({ terminal }) => {
  const term = await testsDue(terminal, 50);
  await expectTerminal(term.getByText(new RegExp(`\\.\\.\\.\\S*/${path.basename(process.cwd())} `))).toBeVisible();
});
```
