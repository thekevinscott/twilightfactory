import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);

export const registerAgent = (
  pi: ExtensionAPI,
  name: string,
  { description, systemPrompt }: { description: string; systemPrompt: string },
): { dispose: () => void } => {
  const request: {
    version: 1;
    name: string;
    definition: { description: string; systemPrompt: string; extensions: string[] };
    result?: { ok: true; registration: { dispose: () => void } } | { ok: false; error: Error };
  } = {
    version: 1,
    name,
    definition: {
      description,
      systemPrompt,
      // Background children load only these extensions; the parent's claude-bridge model resolves through it.
      extensions: [require.resolve("pi-claude-bridge/src/index.ts")],
    },
  };
  pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
  if (!request.result) { throw new Error(`pi-subagents did not register the ${name} agent`); }
  if (!request.result.ok) { throw request.result.error; }
  return request.result.registration;
};

export const startAgent = (pi: ExtensionAPI, name: string, cwd: string, task: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => {
      off();
      const { success, error } = reply as { success: boolean; error?: { message: string } };
      if (success) { resolve(); } else { reject(new Error(`${name}: ${error?.message ?? "spawn failed"}`)); }
    });
    pi.events.emit("subagents:rpc:v1:request", {
      version: 1,
      requestId,
      method: "spawn",
      params: { agent: name, task, cwd },
      source: { extension: "twilightfactory" },
    });
  });
