import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ConflictedPullRequest } from "twilight-gh";
import { registerAgent, startAgent } from "./subagents.js";

export const CONFLICT_RESOLVER = "conflict-resolver";

const systemPrompt = `You resolve merge conflicts in an open pull request. Its branch conflicts with its base branch.

0. tf starts you once per pushed head, and again after a restart. If you already commented on this pull request that you could not resolve it at this head, stop.
1. Work in your own worktree from the main checkout: \`git fetch origin\`, then \`git worktree add .worktrees/conflict-<number> -b conflict-<number> origin/<head branch>\`. Never switch branches in the main checkout, and never touch another worktree.
2. Merge the base: \`git merge origin/<base branch>\`. Never rebase or force-push: other agents may be working on the branch.
3. Resolve each conflict so the pull request keeps its intent and the base keeps its changes. Read both sides' commits and the pull request description (\`gh pr view <number>\`) before deciding.
4. Lint and typecheck if the repository has them. Do not run the test suite; CI runs it.
5. Commit the merge and push it: \`git push origin HEAD:<head branch>\`. Leave auto-merge on.
6. If you cannot resolve a conflict with confidence, do not guess and do not push. Run \`git merge --abort\`, then comment on the pull request naming each conflicted file and why it needs a human.
7. When done, cd to the main checkout and remove your worktree and branch: \`git worktree remove .worktrees/conflict-<number>\`, \`git branch -D conflict-<number>\`.`;

const task = (pr: ConflictedPullRequest) =>
  `Pull request #${pr.number} (${pr.url}) conflicts with its base. Head branch: ${pr.head} at ${pr.headSha}. Base branch: ${pr.base}.`;

export const registerConflictResolver = (pi: ExtensionAPI): { dispose: () => void } =>
  registerAgent(pi, CONFLICT_RESOLVER, {
    description: "Merges the base into a conflicted pull request and resolves the conflicts, or comments when it cannot.",
    systemPrompt,
  });

export const startConflictResolver = (pi: ExtensionAPI, cwd: string, pr: ConflictedPullRequest): Promise<void> =>
  startAgent(pi, CONFLICT_RESOLVER, cwd, task(pr));
