# Twilight Factory

Twilight factory (`tf`) runs the development loop for a GitHub repository so that agents can write, merge and fix the code with little human reading. It is the Pi coding agent plus an extension. Start it with `tf` in the repository's main checkout. It watches GitHub, decides when tests run on `main`, turns on auto-merge for new pull requests, and starts agents to fix a red `main` or resolve merge conflicts.

This text is printed by `tf context`. It is meant for a person, or to paste into an agent. Points marked (unconfirmed) are not backed by a written source yet.

## Why it exists

Kevin's words, from his notes:

- "The world I'm asking for is one of purely agentic engineering where I barely read the codebase. For that to work, all these things need to be super visible and measurable."
- The bottlenecks were review and CI. "I never want to be the bottleneck. That's why I want to sculpt via test."
- "I think a better strategy is to merge by default, with no CI. Assume that bugs will merge and fix them after the fact." And: "Run CI on a timer (once an hour)."
- "the whole point of this repo is not to have required checks". Pull requests merge as soon as they are opened. `main` is guarded by tf's state machine after the fact, not by branch protection before it.
- "An issue ideally should not last more than a day."
- "red should only be triggered specifically on tests failing, not infra". And: "If it is noisy then it's flaky."
- "let's keep it super light weight to begin with. No linting, nothing but black box integration tests." Lint has since been added: Biome, every rule on, in a pre-commit hook and in CI.
- Tests are black box. They run the real program, not its parts. Speed and memory are measured too. "The suite is the spec, yes. This is how it should be."
- "Prefer derived state always; store only if absolutely necessary." tf keeps no state of its own. Everything is read back from GitHub: runs, pull requests, issues.
- No rollback: "too complicated for a solo dev". A red `main` is fixed forward.
- "I have 30+ open source packages, and I would like them all to adopt this workflow eventually. I'm not going to manually maintain 30 different CI loops."
- tf runs on Kevin's machine so agents use his subscription: "running a factory from my local machine that monitors GitHub".
- Review is for steering, later, not for gating: "it's really not about gating it's about sculpting."

Points not written down anywhere:

- Tests carry Kevin's intent, so agents should not weaken a test to make it pass. `CODEOWNERS` names Kevin as owner of `/tests/`. Whether that is enforced, given there are no required checks, is open. (unconfirmed)
- One tf runs per repository, from the main checkout. (unconfirmed as a rule; the planning notes say "There will never be two tf instances.")

## How it works

### Pi and the extension

`tf` starts Pi with Claude (`claude-opus-5-5` through the claude-bridge provider), the pi-subagents extension, and tf's own extension (`packages/twilight-factory/src/extension.ts`). Pi's chat works as usual. The extension adds:

- A one-line footer with the state: waiting, tests due, red, or sign in to GitHub.
- A pane pinned to the top of Pi listing open pull requests and the most recently closed ones (`pr-pane.ts`).
- Tools the model can call for live state: `tf_state`, `tf_pull_requests`, `tf_issues`, `tf_ci_runs` (`chat-context.ts`).

tf signs in to GitHub with the `gh` token or a device-flow login. With a GitHub App configured, it starts test runs as the app.

`tf context` prints this text and exits. It does not start Pi.

### The CI state machine

About once a minute tf asks the state machine (`packages/state-machine`) what to do. The machine reads only what it needs from GitHub and returns one state. tf acts on it, and the next tick asks again. Nothing is stored between ticks.

There are two kinds of test run, both of `tests.yml` on `main`. A plain run checks behavior. A measured run also checks speed and memory.

The states, as the code has them:

| Last run on main | State |
|---|---|
| none | `GO_MEASURED` |
| in progress or queued | `STOP` |
| completed without success (failed, cancelled, timed out), no issue labeled `red` open | `FILE_ISSUE` |
| completed without success, a `red` issue open | `STOP` |
| passed less than an hour ago | `STOP` |
| passed an hour ago or more, last measured run did not pass | `GO_MEASURED` |
| passed an hour ago or more, no new commits | `STOP` |
| passed an hour ago or more, new commits, a measured run in the last day | `GO_PLAIN` |
| passed an hour ago or more, new commits, no measured run in a day | `GO_MEASURED` |

Anything short of success counts as red, because GitHub reports a job timeout as cancelled. Telling a test failure from an infrastructure failure is still open.

On `GO_PLAIN` or `GO_MEASURED`, tf dispatches `tests.yml` on `main` with that kind, once per head commit. Only tf dispatches runs on `main`.

Changing the state machine needs Kevin's explicit approval.

### Red main: the red fixer

On `FILE_ISSUE`, tf starts the red fixer agent once per failed run (`red-fixer.ts`). The fixer reads the failed logs, files one issue labeled `red` (which moves the machine to `STOP`), works in its own worktree, reproduces the failure with only the failing test file, fixes the cause without reverting commits, opens a pull request that says `Fixes #<issue>`, and dispatches `tests.yml` on its branch. Only a green run on GitHub counts as fixed. It gets three attempts. After a third red run it comments on the issue that Kevin needs to look, and stops.

### Pull requests

tf watches pull requests through an event source (`packages/gh/src/events.ts`). It polls GitHub about once a minute. The event source can also take webhooks, but tf does not use them yet.

- Opened: tf turns on auto-merge (merge commit). It skips drafts. Pull requests opened while tf was not running are missed.
- Conflicted: tf starts the conflict resolver agent (`conflict-resolver.ts`). It merges the base into the branch in its own worktree, never rebases or force-pushes, lints and typechecks, and pushes. If it cannot resolve a conflict with confidence, it aborts and comments on the pull request naming the files.
- Merged: tf removes the branch's worktree under `.worktrees/` and deletes the branch, unless the worktree has uncommitted changes, unpushed commits, or a process running in it (`worktrees.ts`).

### GitHub workflows

- `tests.yml`: lint, then the full test suite in Docker. Started by hand only (`workflow_dispatch`), with `kind` plain or measured.
- `main-is-green.yml`: a check on each pull request that fails while `main` is red. A pull request labeled `run-ci` is judged by its own `tests.yml` run instead. It is not a required check.
- `recheck-blocked.yml` and `recheck-run-ci.yml`: when a tests run finishes, re-run the failed "Main is green" checks so they pick up the new result.

## Rules agents follow

From `AGENTS.md`, which is the authority if the two differ.

- Red/green TDD. Write the failing test first. Run only that test locally and watch it fail for the reason you expect. Then write the code and push. Never run the full suite locally: CI is the source of truth, and speed and memory numbers are only accurate there. Lint and typecheck locally are fine.
- Lint runs in a pre-commit hook. Never skip it. Turn a rule off in `biome.jsonc` with a one-line reason, or for one site with `// biome-ignore`.
- Pull requests merge right away. There are no required checks, on purpose. Open a pull request when the work is ready, and it merges. Turn on auto-merge with `gh pr merge <number> --auto --merge` if tf has not. Open a draft only for work that is not ready, such as work waiting on Kevin's review.
- You may dispatch `tests.yml` on your own branch. Never on `main`: those runs belong to the state machine.
- Do not change the state machine without Kevin's explicit approval. Propose it in an issue and wait.
- When Kevin raises a bug, request, idea or follow-up, file a GitHub issue right away, with his words in the body. One concern per issue.
- The main checkout stays on `main`, because the running `tf` uses it. Work in a worktree: `git worktree add .worktrees/<branch> -b <branch> origin/main`. To remove one, `cd` to the main checkout first.

## Where things live

- `packages/twilight-factory`: the `tf` command and the Pi extension. `src/cli.ts` is the entry point. This text is `docs/context.md` in that package.
- `packages/state-machine`: the CI state machine, published as `twilight-state-machine`.
- `packages/gh`: every GitHub call, and the event source for webhooks and polling.
- `packages/test-proxy`: an HTTPS proxy that records and replays network traffic for tests.
- `tests/specs`: the black-box test suite. `tests/fixtures` holds recorded GitHub answers. `tests/docker` holds the container the tests run in, with no network in replay mode.
- `.github/workflows`: the workflows above. `.github/CODEOWNERS`: Kevin owns `/tests/`.
- `AGENTS.md`: the rules for agents.
- `~/.config/twilightfactory/`: the GitHub token and the optional GitHub App config.
