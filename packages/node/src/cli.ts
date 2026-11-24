#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { execa } from "execa";
import { recentActions } from "./gh/actions.js";
import { headCommit } from "./gh/head.js";
import { recentTags } from "./gh/tags.js";

const { version, description } = createRequire(import.meta.url)("../package.json") as {
  version: string;
  description: string;
};

const program = new Command("tf").description(description).version(version);

program.action(async () => {
  const pi = await execa("pi", { stdio: "inherit", reject: false });
  if ("code" in pi && pi.code === "ENOENT") {
    throw new Error("pi is not on PATH. Install the Pi coding agent, then run tf again.");
  }
  process.exitCode = pi.exitCode ?? 1;
});

const gh = program.command("gh").description("GitHub state for this repository");

gh.command("actions")
  .description("List the most recent GitHub Actions runs")
  .option("-n, --limit <count>", "how many runs to list", "10")
  .action(async ({ limit }: { limit: string }) => {
    console.log(await recentActions(Number(limit)));
  });

gh.command("tags")
  .description("List the most recent green tags, newest first")
  .option("-n, --limit <count>", "how many tags to list", "10")
  .action(async ({ limit }: { limit: string }) => {
    console.log(await recentTags(Number(limit)));
  });

gh.command("head")
  .description("Show the head commit of the default branch")
  .action(async () => {
    console.log(await headCommit());
  });

await program.parseAsync();
