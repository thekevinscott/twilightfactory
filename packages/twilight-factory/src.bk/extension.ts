import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Client } from "./daemon/client.js";
import { daemonSocket } from "./daemon/ensure.js";
import { repoRoot } from "./repo.js";
import { actionLine, agentLine, statusText, widgetLines } from "./status.js";
import type { Snapshot } from "./types.js";

const KEY = "twilightfactory";
const PICKED = 10;
const NO_DAEMON = "tf: no daemon for this repo. Quit and run tf, then /reload.";

interface Shown {
  title: string;
  text: string;
}

export default function factory(pi: ExtensionAPI) {
  let client: Client | null = null;
  let stopping = new AbortController();
  let latest: Snapshot | null = null;

  async function disconnect(): Promise<void> {
    stopping.abort();
    const open = client;
    client = null;
    latest = null;
    await open?.close();
  }

  async function follow(open: Client, signal: AbortSignal, ctx: ExtensionContext): Promise<void> {
    try {
      for await (const state of open.states(signal)) {
        latest = state;
        ctx.ui.setWidget(KEY, widgetLines(state, (line) => ctx.ui.theme.fg("error", line)));
      }
    } catch {}
    if (!signal.aborted) {
      ctx.ui.setWidget(KEY, ["tf: the daemon stopped. Run tf status in a shell, then /reload."]);
    }
  }

  function daemon(): Client {
    if (!client) {
      throw new Error(NO_DAEMON);
    }
    return client;
  }

  function command(
    name: string,
    description: string,
    work: (args: string, ctx: ExtensionContext) => Promise<void>,
    complete?: () => string[],
  ): void {
    pi.registerCommand(name, {
      description,
      getArgumentCompletions: complete
        ? (prefix) => {
            const found = complete().filter((value) => value.startsWith(prefix));
            return found.length ? found.map((value) => ({ value, label: value })) : null;
          }
        : undefined,
      handler: async (args, ctx) => {
        try {
          await work(args.trim(), ctx);
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
      },
    });
  }

  pi.registerEntryRenderer<Shown>(KEY, (entry, _options, theme) => {
    const shown = entry.data ?? { title: "", text: "" };
    return new Text(`${theme.fg("accent", shown.title)}\n${shown.text.trimEnd() || "(empty)"}`, 1, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    await disconnect();
    const path = await daemonSocket(await repoRoot(ctx.cwd)).catch(() => null);
    if (!path) {
      ctx.ui.setWidget(KEY, [NO_DAEMON]);
      return;
    }
    client = new Client(path);
    stopping = new AbortController();
    void follow(client, stopping.signal, ctx);
  });

  pi.on("session_shutdown", disconnect);

  command("tf-status", "Show the factory's branch, events, action runs and agents", async () => {
    pi.appendEntry<Shown>(KEY, { title: "tf status", text: statusText(await daemon().status()) });
  });

  command(
    "tf-run",
    "Run a configured action now",
    async (typed, ctx) => {
      const names = (await daemon().status()).actions.map((action) => action.name);
      if (!typed && names.length === 0) {
        throw new Error("no actions in twilightfactory.toml");
      }
      const name = typed || (await ctx.ui.select("Run which action", names));
      if (name) {
        ctx.ui.notify(`started ${name} (${await daemon().runAction(name)})`, "info");
      }
    },
    () => latest?.actions.map((action) => action.name) ?? [],
  );

  command(
    "tf-log",
    "Show the log of an action run or agent",
    async (typed, ctx) => {
      const state = await daemon().status();
      const runs = [
        ...state.action_runs.slice(0, PICKED).map((run) => ({ kind: "actions" as const, id: run.id, line: actionLine(run) })),
        ...state.agents.slice(0, PICKED).map((run) => ({ kind: "agents" as const, id: run.id, line: `${agentLine(run)}  ${run.id}` })),
      ];
      if (!typed && runs.length === 0) {
        throw new Error("no runs yet");
      }
      const line = typed || (await ctx.ui.select("Show which log", runs.map((run) => run.line)));
      if (!line) {
        return;
      }
      const run = runs.find((found) => found.id === line || found.line === line);
      const kind = run?.kind ?? "actions";
      const id = run?.id ?? line;
      pi.appendEntry<Shown>(KEY, { title: `tf log ${kind} ${id}`, text: await daemon().log(kind, id) });
    },
    () => [...(latest?.action_runs ?? []), ...(latest?.agents ?? [])].map((run) => run.id),
  );

  command("tf-agent", "Create an agent worktree; no prompt uses [agent] prompt_file", async (typed, ctx) => {
    const prompt = typed || (await ctx.ui.input("Agent prompt (empty uses [agent] prompt_file)"));
    if (prompt !== undefined) {
      ctx.ui.notify(`agent worktree created (${await daemon().startAgent(prompt)})`, "info");
    }
  });
}
