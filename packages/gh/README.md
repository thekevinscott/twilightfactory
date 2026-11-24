# twilight-gh

The `gh` commands twilightfactory needs, one function each. Every function takes the repo as `owner/name` and shells out to `gh`, so auth is whatever `gh` already uses.

| Function | Command |
|---|---|
| `lastRun(repo)` | `gh run list --workflow tests.yml --branch main --limit 1` |
| `lastMeasuredRun(repo)` | the newest of the last 100 runs whose title has `(measured)` |
| `head(repo)` | `gh api repos/{repo}/commits/HEAD` |
| `openRedIssue(repo)` | `gh issue list --label red --state open` |
| `blockedPullRequests(repo)` | `gh pr list --state open`, keeping those whose `Main is green` check failed |
| `startRun(repo, kind)` | `gh workflow run tests.yml --ref main -f kind=plain\|measured` |
| `fileIssue(repo, run)` | `gh issue create --label red` |
| `rerunCheck(repo, runId)` | `gh run rerun <runId> --failed` |

The workflow must set `run-name: Tests (${{ inputs.kind }})` so measured runs can be told apart.
