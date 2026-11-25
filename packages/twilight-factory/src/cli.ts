#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  InteractiveMode,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { stageClaudeExecutable } from "./claude-executable.js";
import tfExtension from "./extension.js";

const require = createRequire(import.meta.url);
const { version, description } = require("../package.json") as {
  version: string;
  description: string;
};

const OVERRIDES = { defaultProvider: "claude-bridge", defaultModel: "claude-opus-5-5", quietStartup: true } as const;

const program = new Command("tf").description(description).version(version);

program.action(async () => {
  const claudeExecutable = stageClaudeExecutable();
  if (claudeExecutable) process.env.CLAUDE_BRIDGE_CLAUDE_EXECUTABLE ??= claudeExecutable;
  const cwd = process.cwd();
  const agentDir = getAgentDir();

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const settingsManager = SettingsManager.create(cwd, agentDir);
    // Pi rebuilds `settings` from disk on reload, save and trust changes, dropping applyOverrides.
    let settings = { ...(settingsManager as unknown as { settings: object }).settings, ...OVERRIDES };
    Object.defineProperty(settingsManager, "settings", {
      get: () => settings,
      set: (next: object) => {
        settings = { ...next, ...OVERRIDES };
      },
    });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      resourceLoaderOptions: {
        additionalExtensionPaths: [require.resolve("pi-claude-bridge/src/index.ts"), require.resolve("pi-subagents")],
        extensionFactories: [{ name: "twilightfactory", factory: tfExtension, hidden: true }],
      },
    });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager: SessionManager.create(cwd) });
  await new InteractiveMode(runtime).run();
});

await program.parseAsync();
