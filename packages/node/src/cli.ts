#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { execa } from "execa";
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

const program = new Command("tf").description(
  "Watch this repo's default branch, run actions on new commits, start local agents. With no command, opens pi with the factory extension.",
);

program
  .command("daemon")
  .description("run the daemon for the repo in the current directory, in the foreground")
  .action(async () => {
    await serveDaemon(await repoRoot(process.cwd()));
  });

program
  .argument("[pi options...]", "options passed on to pi; the first must start with a dash")
  .allowUnknownOption()
  .action(async (passed: string[]) => {
    if (passed[0] && !passed[0].startsWith("-")) {
      throw new Error(`unknown command "${passed[0]}". See tf --help.`);
    }
    const root = await repoRoot(process.cwd());
    await ensureDaemon(root);
    const extension = fileURLToPath(new URL("./extension.js", import.meta.url));
    const pi = await execa("pi", ["--extension", extension, ...passed], {
      cwd: root,
      stdio: "inherit",
      reject: false,
    });
    if (pi.code === "ENOENT") {
      throw new Error("pi is not on PATH. Install the Pi coding agent, then run tf again.");
    }
    process.exitCode = pi.exitCode ?? 1;
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
