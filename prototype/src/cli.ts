#!/usr/bin/env node
import { Command } from "commander";
import { Client } from "./daemon/client.js";
import { daemonSocket, ensureDaemon } from "./daemon/ensure.js";
import { serveDaemon } from "./daemon/server.js";
import { repoRoot } from "./repo.js";
import { statusText } from "./status.js";

async function attached<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const root = await repoRoot(process.cwd());
  const client = new Client(await ensureDaemon(root));
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

const program = new Command("twilightfactory").description(
  "Watch this repo's default branch, run actions on new commits, start local agents.",
);

program
  .command("daemon")
  .description("run the daemon for the repo in the current directory, in the foreground")
  .action(async () => {
    await serveDaemon(await repoRoot(process.cwd()));
  });

program
  .command("tui")
  .description("open the TUI, starting the daemon if needed")
  .action(async () => {
    const { runTui } = await import("./tui.js");
    await attached(runTui);
  });

program
  .command("status")
  .description("print the current state and exit")
  .action(async () => {
    console.log(statusText(await attached((client) => client.status())));
  });

program
  .command("run <action>")
  .description("run a configured action now")
  .action(async (action: string) => {
    console.log(await attached((client) => client.runAction(action)));
  });

program
  .command("agent [prompt]")
  .description("start an agent in a new worktree; no prompt uses [agent] prompt_file")
  .action(async (prompt: string | undefined) => {
    console.log(await attached((client) => client.startAgent(prompt ?? "")));
  });

program
  .command("log <run>")
  .description("print the log of an action run")
  .action(async (run: string) => {
    process.stdout.write(await attached((client) => client.log("actions", run)));
  });

program
  .command("stop")
  .description("stop the daemon for this repo")
  .action(async () => {
    const path = await daemonSocket(await repoRoot(process.cwd()));
    if (!path) {
      console.log("no daemon running");
      return;
    }
    const client = new Client(path);
    await client.stop();
    await client.close();
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
// execa keeps a handle on the detached daemon it started; leave without waiting for it.
process.exit();
