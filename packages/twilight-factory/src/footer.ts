import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

const labels: Record<string, [dot: string, text: string]> = {
  "…": ["⚪", "checking"],
  NOT_SET_UP: ["⚪", "not set up"],
  QUIET: ["🟢", "all quiet"],
  FIXING: ["🔴", "fixing"],
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

const truncateLeft = (text: string, max: number): string => {
  if (text.length <= max) return text;
  if (max <= 3) return "";
  return `...${text.slice(text.length - (max - 3))}`;
};

// Replaces Pi's two footer lines with one: the tf state, the directory, the model.
export const stateDisplay = (_pi: ExtensionAPI) => {
  let state = "…";
  let tui: TUI | undefined;

  return {
    attach: (ctx: ExtensionContext) => {
      ctx.ui.setFooter((ui, theme) => {
        tui = ui;
        return {
          invalidate() {},
          render(width: number): string[] {
            const status = `${label(state)}  `;
            const model = ctx.model?.id ?? "";
            const room = width - visibleWidth(status) - visibleWidth(model) - 1;
            const cwd = truncateLeft(ctx.cwd.replace(process.env.HOME ?? "\0", "~"), room);
            const left = status + theme.fg("dim", cwd);
            const right = theme.fg("dim", model);
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
