import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgent, startAgent } from "./subagents.js";

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

export const registerRedFixer = (pi: ExtensionAPI): { dispose(): void } =>
  registerAgent(pi, RED_FIXER, { description: "Files a red issue for a failed run on main and pushes a fix.", systemPrompt });

export const startRedFixer = (pi: ExtensionAPI, cwd: string, run: { id: number; url: string; headSha: string }): Promise<void> =>
  startAgent(pi, RED_FIXER, cwd, task(run));
