import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

// The fixture has two open pull requests and seven closed ones, listed in an order unlike their close times.
const pane = (terminal) => startTf(terminal, { fixture: 'pr-pane/recent', env: { GH_TOKEN: 'gho_pane' }, cols: 120 }).term;

test('It shows every open pull request in a pane at the top', async ({ terminal }) => {
  const term = pane(terminal);
  await expectTerminal(term.getByText(/#91\s+open\s+Open and in review/)).toBeVisible();
  await expectTerminal(term.getByText(/#90\s+open\s+Open since last week/)).toBeVisible();
});

test('It shows the 5 most recently closed pull requests, merged or not', async ({ terminal }) => {
  const term = pane(terminal);
  await expectTerminal(term.getByText(/#88\s+closed\s+Closed on the 23rd/)).toBeVisible();
  await expectTerminal(term.getByText(/#85\s+merged\s+Merged on the 22nd/)).toBeVisible();
  await expectTerminal(term.getByText(/#87\s+merged\s+Merged on the 21st/)).toBeVisible();
  await expectTerminal(term.getByText(/#89\s+merged\s+Merged on the 20th/)).toBeVisible();
  await expectTerminal(term.getByText(/#83\s+merged\s+Merged on the 19th/)).toBeVisible();
  await expectTerminal(term.getByText('Merged on the 3rd')).notToBeVisible();
  await expectTerminal(term.getByText('Closed on the 4th')).notToBeVisible();
});
