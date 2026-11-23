# twilightfactory prototype

A daemon per git repo, with a TUI attached. It watches the default branch on
the remote, runs configured shell commands when the head moves or on a timer,
and creates worktrees for local agents. Nothing here pushes.

## Build

Node 24 and pnpm.

```
pnpm --dir prototype install --ignore-workspace
pnpm --dir prototype run build
```

## Run

Every command acts on the git repo in the current directory. Run the built
file with node from inside the target repo:

```
node /path/to/twilightfactory/prototype/dist/cli.js tui
```

`pnpm --dir prototype exec twilightfactory` does not work: pnpm does not link
a package's own bin, and `--dir` would change the directory away from the
target repo. A fish alias covers it:

```
alias twilightfactory "node /path/to/twilightfactory/prototype/dist/cli.js"
```

Commands:

```
twilightfactory daemon           run the daemon in the foreground
twilightfactory tui              open the TUI
twilightfactory status           print the same summary as text
twilightfactory run <action>     run a configured action now, prints the run id
twilightfactory log <run id>     print an action run's output
twilightfactory agent "<prompt>" create an agent worktree
twilightfactory stop             stop the daemon
```

All but `daemon` and `stop` find the daemon for the repo and start one in the
background if none is running. A background daemon stays up until `stop`.

TUI keys: `r` run an action, `a` start an agent with a typed prompt, `tab`
switch between action runs and agents, `j`/`k` or arrows move, `l` or enter
open the log of the selected run, `esc` back, `q` quit.

## Config

`twilightfactory.toml` at the target repo root. Without it the daemon watches
and records, and runs nothing. It is read again at every poll.

```toml
poll_seconds = 60        # how often to check the remote head
timer_seconds = 3600     # optional; runs "timer" actions this often
remote = "origin"        # optional
# branch = "main"        # optional; default is the remote's default branch

[[action]]
name = "tests"
command = "gh workflow run markdown-tests.yml --ref main"
on = ["head", "timer"]   # any of "head", "timer"; leave out for manual only

[agent]
prompt_file = "agent-prompt.md"   # used when `agent` is given no prompt
```

Actions run through the shell in the repo root, with `TWILIGHTFACTORY_HEAD`
and `TWILIGHTFACTORY_TRIGGER` set. Actions for one trigger run one after
another in file order. Any action can be run by hand.

## Where things are kept

`$XDG_STATE_HOME/twilightfactory/<hash of repo path>/` (default
`~/.local/state`), one JSON file per record:

```
records/events/<id>.json
records/actions/<id>/run.json   and output.log
records/agents/<id>/run.json
daemon.socket  daemon.lock  daemon.stderr
```

The daemon reads the records back with dirsql (tables `events`,
`action_runs`, `agent_runs`). The socket is in
`$XDG_RUNTIME_DIR/twilightfactory/`.

## Agents: not finished

`agent` fetches the default branch, creates
`.worktrees/agent-<id>` on a new branch `twilightfactory/agent-<id>`, records
it, and stops. The agent itself is not run. botbox is a Python library with no
command line, and this daemon is not Python, so there is nothing to call.

## Try it on a throwaway repo

```
git init --bare -b main /tmp/tf/origin.git
git clone /tmp/tf/origin.git /tmp/tf/work
cd /tmp/tf/work
printf 'poll_seconds = 2\n\n[[action]]\nname = "date"\ncommand = "date"\non = ["head"]\n\n[[action]]\nname = "fail"\ncommand = "false"\non = ["head"]\n' > twilightfactory.toml
git add twilightfactory.toml
git commit -m first
git push origin main
twilightfactory status
git commit --allow-empty -m second
git push origin main
twilightfactory status
twilightfactory tui
twilightfactory stop
```

The second `status` shows a `head` event, `date` passed and `fail` failed.
