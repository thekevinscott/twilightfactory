import { describe, expect, test } from 'vitest';
import { decide } from '../../../.github/scripts/main-is-green.mjs';

const run = (status: string, conclusion: string | null = null) => ({ status, conclusion, html_url: 'https://example.com/run' });

describe('Without run-ci', () => {
  test('the gate passes when main is green', () => {
    expect(decide({ optedIn: false, mainRun: run('completed', 'success') })).toMatchObject({ pass: true, dispatch: false });
  });

  test('the gate fails when main is red', () => {
    expect(decide({ optedIn: false, mainRun: run('completed', 'failure') })).toMatchObject({ pass: false, dispatch: false });
  });

  test('the gate passes when main has no completed run', () => {
    expect(decide({ optedIn: false, mainRun: null })).toMatchObject({ pass: true, dispatch: false });
  });
});

describe('With run-ci', () => {
  test('the gate passes when the run on the head passed, even with main red', () => {
    expect(decide({ optedIn: true, ownRun: run('completed', 'success'), mainRun: run('completed', 'failure') })).toMatchObject({
      pass: true,
      dispatch: false,
    });
  });

  test('the gate fails when the run on the head failed, even with main green', () => {
    expect(decide({ optedIn: true, ownRun: run('completed', 'failure'), mainRun: run('completed', 'success') })).toMatchObject({
      pass: false,
      dispatch: false,
    });
  });

  test('the gate fails and waits while the run on the head is going', () => {
    const result = decide({ optedIn: true, ownRun: run('in_progress'), mainRun: run('completed', 'success') });
    expect(result).toMatchObject({ pass: false, dispatch: false });
    expect(result.message).toContain('waiting');
  });

  test('with no run on the head, the gate dispatches one and fails until it finishes', () => {
    const result = decide({ optedIn: true, ownRun: null, mainRun: run('completed', 'success') });
    expect(result).toMatchObject({ pass: false, dispatch: true });
  });
});
