# Agents

## Red/green TDD

Every feature and fix starts with a failing test.

1. Write the new test first.
2. Run only that test and watch it fail for the reason you expect.
3. Write the code.
4. Push. CI runs the full suite.

Step 2 is the only time to run tests locally. Never run the full suite locally: CI is the source of truth, and speed and memory numbers are only accurate there.

Run one test by its name with vitest's `-t` filter, or one file by its path:

```sh
just test -t 'It shows help'
just test tests/specs/twilight-factory/basic.test.ts
```

Lint and typecheck locally are fine.

Spec files are named `<name>.test.ts`, with no numeric prefix.

## Lint

`just install` sets up a pre-commit hook (lefthook) that runs Biome with every rule on over the staged files. CI runs the same lint on the whole repo.

- Never skip the hook: no `git commit --no-verify`, no `LEFTHOOK=0`. Fix the finding instead.
- To turn a rule off, do it in `biome.jsonc` with a one-line reason. For one site, use `// biome-ignore lint/<group>/<rule>: <reason>`.

## Pull requests

The repo has no required checks, on purpose. Main is guarded by tf's state machine, not by branch protection. Don't add required checks or propose them.

So auto-merge does not wait for tests. Agents merge their own PRs only after a green branch run:

1. Open every PR as a draft: `gh pr create --draft`.
2. Dispatch `tests.yml` on your branch: `gh workflow run tests.yml --ref <branch>`.
3. Wait for that run to go green.
4. Mark the PR ready, then turn on auto-merge: `gh pr ready <number>`, then `gh pr merge <number> --auto --merge`.

- If you merge origin/main into your branch, rerun the branch tests and wait for green before marking ready.
- While `tf` runs, it turns on auto-merge (merge commit) for every pull request opened in the repo. It polls about once a minute, skips drafts, and misses pull requests opened while it was not running. This is why PRs start as drafts.
- Avoid turning auto-merge off (`gh pr merge --disable-auto`).
- Never use `--ref main`: only `tf` dispatches runs on main, because those runs belong to its state machine.

## State machine

Any change to the state machine (`packages/state-machine`: its states, inputs, order of checks, or what tf does on a state) needs Kevin's explicit approval first. Propose it in an issue and wait. The approved machine is v2 in Kevin's vault note `Notes/new CI flow/dirsql markdown tests CI flow.md`.

## Issues

When Kevin raises a bug, request, idea or follow-up, file a GitHub issue right away. Don't ask first.

- Put Kevin's words in the body. Add links, run IDs or file paths as context.
- One concern per issue.
- Questions that only ask for information don't need an issue.

## Worktrees

The main checkout stays on `main`. Never switch branches there: the global `tf` command runs from it.

Do all work in a worktree under `.worktrees/`:

```sh
git worktree add .worktrees/<branch> -b <branch> origin/main
```

To remove one, `cd` to the main checkout first, then `git worktree remove .worktrees/<branch>`.
