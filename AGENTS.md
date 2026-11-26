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

## Lint

`just install` sets up a pre-commit hook (lefthook) that runs Biome with every rule on over the staged files. CI runs the same lint on the whole repo.

- Never skip the hook: no `git commit --no-verify`, no `LEFTHOOK=0`. Fix the finding instead.
- To turn a rule off, do it in `biome.jsonc` with a one-line reason. For one site, use `// biome-ignore lint/<group>/<rule>: <reason>`.

## Pull requests

Agents merge their own PRs once CI is green.

- When a PR is complete, turn on auto-merge: `gh pr merge <number> --auto --merge`. GitHub merges it when the checks pass.
- While `tf` runs, it turns on auto-merge (merge commit) for every pull request opened in the repo, so this usually happens without you. It polls about once a minute, skips drafts, and misses pull requests opened while it was not running.
- Avoid turning auto-merge off (`gh pr merge --disable-auto`).
- Don't push work that isn't ready. If you have to push it early, open the PR as a draft (`gh pr create --draft`) and turn on auto-merge only after `gh pr ready`.
- To check a PR, you may dispatch `tests.yml` on your branch: `gh workflow run tests.yml --ref <branch>`. Never use `--ref main`: only `tf` dispatches runs on main, because those runs belong to its state machine.

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
