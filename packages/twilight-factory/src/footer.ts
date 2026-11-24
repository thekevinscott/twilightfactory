import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

const labels: Record<string, [dot: string, text: string]> = {
  "…": ["⚪", "checking"],
  NOT_SET_UP: ["⚪", "not set up"],
  STOP: ["⚪", "waiting"],
  GO_PLAIN: ["🔵", "tests due"],
  GO_MEASURED: ["🔵", "tests due"],
  RECHECK_PRS: ["🟡", "PRs blocked"],
  FILE_ISSUE: ["🔴", "red"],
  SIGN_IN: ["🟡", "sign in to GitHub"],
};

export const label = (state: string): string => {
  const known = labels[state];
  if (known) return `${known[0]} ${known[1]}`;
  return `🔴 ${state.replace(/ - https?:\/\/\S+$/, "")}`;
};

// Replaces Pi's two footer lines with one: the tf state, the directory and branch, the model.
export const stateDisplay = (_pi: ExtensionAPI) => {
  let state = "…";
  let tui: TUI | undefined;

  return {
    attach: (ctx: ExtensionContext) => {
      ctx.ui.setFooter((ui, theme, footerData) => {
        tui = ui;
        const unsubscribe = footerData.onBranchChange(() => ui.requestRender());
        return {
          dispose: unsubscribe,
          invalidate() {},
          render(width: number): string[] {
            const branch = footerData.getGitBranch();
            const cwd = ctx.cwd.replace(process.env.HOME ?? "\0", "~");
            const left = `${label(state)}  ${theme.fg("dim", branch ? `${cwd} (${branch})` : cwd)}`;
            const right = theme.fg("dim", ctx.model?.id ?? "");
            const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
            return [truncateToWidth(left + pad + right, width)];
          },
        };
      });
    },
    show: (text: string) => {
      state = text.split("\n")[0] ?? text;
      tui?.requestRender();
    },
  };
};
