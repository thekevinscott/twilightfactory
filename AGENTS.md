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
