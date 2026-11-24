# twilight-gh

The GitHub calls twilightfactory needs, one function each, on Octokit. Every function takes a client from `client(token)` and the repo as `owner/name`.

| Function | Call |
|---|---|
| `lastRun(github, repo)` | newest run of `tests.yml` on main |
| `lastMeasuredRun(github, repo)` | newest of the last 100 runs whose title has `(measured)` |
| `head(github, repo)` | `GET /repos/{repo}/commits/HEAD` |
| `openRedIssue(github, repo)` | open issues labelled `red` |
| `blockedPullRequests(github, repo)` | open pull requests whose `Main is green` check failed (GraphQL) |
| `startRun(github, repo, kind)` | dispatch `tests.yml` on main with `kind=plain\|measured` |
| `fileIssue(github, repo, run)` | create an issue labelled `red` |
| `rerunCheck(github, repo, runId)` | re-run the failed jobs of a run |
| `confirmFix(github, repo)` | dispatch `tests.yml` with the kind of the newest red run, for the fixing agent |

The workflow must set `run-name: Tests (${{ inputs.kind }})` so measured runs can be told apart.
