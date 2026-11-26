# Twilight Factory

This repository is run by twilight factory (`tf`). Pull requests merge automatically. Open yours ready, not as a draft, and auto-merge goes on by itself. There are no required test checks on pull requests, so nothing waits for your branch's tests. The one gate is that nothing merges while `main` is red. Use a draft only for work that is not ready, such as work waiting on Kevin's review. Changes under `/tests/` need Kevin's approval.

CI runs on `main` after the fact, not as a gate. tf is a deterministic loop: about once a minute it reads GitHub, dispatches `tests.yml` on `main` when tests are due, and when a run goes red it files an issue and starts a fixer agent. Conflicted pull requests get a resolver agent. Merged branches get their worktrees cleaned up.

None of that is yours to manage. Don't dispatch runs on `main`, don't merge by hand, don't clean up other worktrees, and don't change the state machine without Kevin's explicit approval.

What you own: work in your own worktree (`git worktree add .worktrees/<branch> -b <branch> origin/main`), never in the main checkout. Write the failing test first and run only that test locally; the full suite runs in CI. Lint and typecheck locally. Then open the pull request. When Kevin raises a bug or request, file a GitHub issue with his words in it. `AGENTS.md` has the details.
