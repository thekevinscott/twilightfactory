# twilightfactory prototype

A daemon per git repo, used from inside the Pi coding agent. It watches the default branch on
the remote, runs configured shell commands when the head moves or on a timer,
and creates worktrees for local agents. Nothing here pushes.

## Build

Node 24 and pnpm. Bare `tf` also needs `pi` (the Pi coding agent) on PATH.

```
pnpm --dir prototype install
pnpm --dir prototype run build
```

`pnpm-workspace.yaml` here only tells pnpm not to run the build scripts of
two packages that come in with Pi's types. Do not pass `--ignore-workspace`:
pnpm then skips that file and the install exits with an error.

## Run

Every command acts on the git repo in the current directory. Install the
`tf` command once, linked to this folder so rebuilds are picked up:

```
pnpm add -g /path/to/twilightfactory/prototype
```

Commands:

```
tf daemon           run the daemon in the foreground
tf                  open pi with the factory extension
tf status           print the same summary as text
tf run <action>     run a configured action now, prints the run id
tf log <run id>     print an action run's output
tf agent "<prompt>" create an agent worktree
tf stop             stop the daemon
```

All but `daemon` and `stop` find the daemon for the repo and start one in the
background if none is running. A background daemon stays up until `stop`.

## Inside pi

Bare `tf` makes sure the daemon is up, then starts your installed `pi` in the
repo root with `dist/extension.js` loaded. Your Pi login and settings apply.
Options after `tf` go to pi, for example `tf --no-session`. The first one
must start with a dash, so a mistyped command is never sent to a model as a
prompt.

Above the editor the extension shows the watched branch and head, the poll
and timer intervals, and the latest result of each action. It updates as the
daemon records things.

Commands:

```
/tf-status            the same summary as tf status
/tf-run [action]      run an action; no name opens a picker
/tf-log [run id]      show a run's log; no id opens a picker of recent runs
/tf-agent [prompt]    create an agent worktree; no prompt asks for one
```

What these print goes into the Pi session but is not sent to the model. If
the daemon stops while pi is open, run `tf status` in a shell and then
`/reload` in pi.

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
tf status
git commit --allow-empty -m second
git push origin main
tf status
tf
tf stop
```

The second `status` shows a `head` event, `date` passed and `fail` failed.
