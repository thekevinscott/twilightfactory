#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { execa } from "execa";

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

await program.parseAsync();
