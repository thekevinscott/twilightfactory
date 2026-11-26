import { expect } from 'vitest';
import { expect as expectTerminal } from 'curtaincall';
import { test } from 'curtaincall/vitest';

type Term = ReturnType<typeof startTf>['term'];

// Rows in the order the pane lists them; see the pr-pane/recent fixture.
const ROWS = ['#91', '#90', '#88', '#85', '#87', '#89', '#83'];

const toggle = (term: Term) => term.write('\x1br');

const highlighted = (term: Term) =>
  ROWS.filter(number => {
    const [cell] = term.getByText(number).cells;
    return cell !== undefined && term._getCharAt(cell.row, cell.col).reverse;
  });

const pane = async (terminal) => {
  const { term } = startTf(terminal, { fixture: 'pr-pane/recent', env: { GH_TOKEN: 'gho_pane' }, cols: 120 });
  await expectTerminal(term.getByText(/#83\s+merged/)).toBeVisible();
  return term;
};

test('It highlights nothing until the pane has focus', async ({ terminal }) => {
  const term = await pane(terminal);
  expect(highlighted(term)).toEqual([]);
});

test('Alt+R focuses the pane and highlights the first pull request', async ({ terminal }) => {
  const term = await pane(terminal);
  toggle(term);
  await expect.poll(() => highlighted(term)).toEqual(['#91']);
});

test('Up and down move the highlight and stop at the ends', async ({ terminal }) => {
  const term = await pane(terminal);
  toggle(term);
  await expect.poll(() => highlighted(term)).toEqual(['#91']);
  term.keyDown();
  await expect.poll(() => highlighted(term)).toEqual(['#90']);
  term.keyUp();
  term.keyUp();
  await expect.poll(() => highlighted(term)).toEqual(['#91']);
  for (let i = 0; i < ROWS.length + 2; i++) term.keyDown();
  await expect.poll(() => highlighted(term)).toEqual(['#83']);
});

test('Esc gives focus back to the input box', async ({ terminal }) => {
  const term = await pane(terminal);
  toggle(term);
  await expect.poll(() => highlighted(term)).toEqual(['#91']);
  term.keyEscape();
  await expect.poll(() => highlighted(term)).toEqual([]);
  term.write('typed after escape');
  await expectTerminal(term.getByText('typed after escape')).toBeVisible();
});

test('Alt+R again gives focus back to the input box', async ({ terminal }) => {
  const term = await pane(terminal);
  toggle(term);
  await expect.poll(() => highlighted(term)).toEqual(['#91']);
  toggle(term);
  await expect.poll(() => highlighted(term)).toEqual([]);
  term.write('typed after toggle');
  await expectTerminal(term.getByText('typed after toggle')).toBeVisible();
});
