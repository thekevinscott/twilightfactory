import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

// The fixture has two open issues, six closed ones listed in an order unlike their close times, and two pull requests.
const pane = (terminal) => startTf(terminal, { fixture: 'pr-pane/recent', env: { GH_TOKEN: 'gho_pane' }, cols: 120 }).term;

test('It shows every open issue in a pane at the top', async ({ terminal }) => {
  const term = pane(terminal);
  await expectTerminal(term.getByText(/#91\s+open\s+Open and in review/)).toBeVisible();
  await expectTerminal(term.getByText(/#90\s+open\s+Open since last week/)).toBeVisible();
});

test('It shows the 5 most recently closed issues', async ({ terminal }) => {
  const term = pane(terminal);
  await expectTerminal(term.getByText(/#85\s+closed\s+Closed on the 22nd/)).toBeVisible();
  await expectTerminal(term.getByText(/#87\s+closed\s+Closed on the 21st/)).toBeVisible();
  await expectTerminal(term.getByText(/#89\s+closed\s+Closed on the 20th/)).toBeVisible();
  await expectTerminal(term.getByText(/#83\s+closed\s+Closed on the 19th/)).toBeVisible();
  await expectTerminal(term.getByText(/#82\s+closed\s+Closed on the 18th/)).toBeVisible();
  await expectTerminal(term.getByText('Closed on the 3rd')).notToBeVisible();
});

test('It leaves pull requests out of the pane', async ({ terminal }) => {
  const term = pane(terminal);
  await expectTerminal(term.getByText(/#91\s+open\s+Open and in review/)).toBeVisible();
  await expectTerminal(term.getByText('Open pull request')).notToBeVisible();
  await expectTerminal(term.getByText('Pull request closed on the 23rd')).notToBeVisible();
});
