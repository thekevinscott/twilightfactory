# Agents

## Red/green TDD

Every feature and fix starts with a failing test.

1. Write the new test first.
2. Run only that test and watch it fail for the reason you expect.
3. Write the code.
4. Push. CI runs the full suite.

Step 2 is the only time to run tests locally. Never run the full suite locally: CI is the source of truth, and speed and memory numbers are only accurate there.

Run one test by its file name. harnessmd writes each heading to its own file, named after the heading in snake case, and vitest filters by path:

```sh
just test it_starts_a_plain_tests_run
```

Lint and typecheck locally are fine.

## Pull requests

Agents merge their own PRs once CI is green.

- When a PR is complete, turn on auto-merge: `gh pr merge <number> --auto --merge`. GitHub merges it when the checks pass.
- Don't push work that isn't ready. If you have to push it early, open the PR as a draft (`gh pr create --draft`) and turn on auto-merge only after `gh pr ready`.
