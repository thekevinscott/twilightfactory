import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);

export const RED_FIXER = "red-fixer";

// TODO(#92): once #92 lands, opt the fix PR into its own CI run with whatever marker #92 defines.
const systemPrompt = `You fix a red main branch. The last tests.yml run on main failed and no issue labeled \`red\` is open.

1. Read the failed run's logs: \`gh run view <run id> --log-failed\`.
2. File one issue labeled \`red\`. Name each failing test, link the run, and quote the assertion error. This tells tf a fix is under way.
3. Work in your own worktree from the main checkout: \`git worktree add .worktrees/red-<run id> -b red-<run id> origin/main\`. Never switch branches in the main checkout.
4. Reproduce the failure by running only the failing test file locally, with COMPOSE_PROJECT_NAME set to your branch name. Never run the full suite.
5. Fix the cause. Never revert commits.
6. Open a PR whose body says \`Fixes #<issue>\`, then \`gh pr merge <number> --auto --merge\`.
7. Dispatch tests.yml on your branch (\`gh workflow run tests.yml --ref <branch> -f kind=plain\`) and wait for it. Only a green run on GitHub counts as fixed.

You get three attempts. An attempt ends when the GitHub run on your branch finishes. After a third red run, comment on the issue saying three fixes failed and Kevin needs to look, then stop.`;

const task = (run: { id: number; url: string; headSha: string }) =>
  `Main is red. Failed tests.yml run ${run.id} at ${run.headSha}: ${run.url}`;

export const registerRedFixer = (pi: ExtensionAPI): { dispose: () => void } => {
  const request: {
    version: 1;
    name: string;
    definition: { description: string; systemPrompt: string; extensions: string[] };
    result?: { ok: true; registration: { dispose: () => void } } | { ok: false; error: Error };
  } = {
    version: 1,
    name: RED_FIXER,
    definition: {
      description: "Files a red issue for a failed run on main and pushes a fix.",
      systemPrompt,
      // Background children load only these extensions; the parent's claude-bridge model resolves through it.
      extensions: [require.resolve("pi-claude-bridge/src/index.ts")],
    },
  };
  pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
  if (!request.result) { throw new Error("pi-subagents did not register the red-fixer agent"); }
  if (!request.result.ok) { throw request.result.error; }
  return request.result.registration;
};

export const startRedFixer = (pi: ExtensionAPI, cwd: string, run: { id: number; url: string; headSha: string }): Promise<void> =>
  new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => {
      off();
      const { success, error } = reply as { success: boolean; error?: { message: string } };
      if (success) { resolve(); } else { reject(new Error(`red-fixer: ${error?.message ?? "spawn failed"}`)); }
    });
    pi.events.emit("subagents:rpc:v1:request", {
      version: 1,
      requestId,
      method: "spawn",
      params: { agent: RED_FIXER, task: task(run), cwd },
      source: { extension: "twilightfactory" },
    });
  });
