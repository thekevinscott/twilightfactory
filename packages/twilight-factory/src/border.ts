import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export const treatments = ["top", "top-tf", "top-color", "bottom", "footer"] as const;
export type Treatment = (typeof treatments)[number];

const MIN_BORDER = 8;

const stateColor = (state: string): "success" | "warning" | "error" | "muted" => {
  if (state.startsWith("GO_")) return "success";
  if (state === "FILE_ISSUE" || state.startsWith("error") || state.startsWith("no GitHub")) return "error";
  if (state === "RECHECK_PRS") return "warning";
  return "muted";
};

// Shows the tf state in Pi's input box border; `/tf-style` switches between treatments live.
export const stateDisplay = (pi: ExtensionAPI) => {
  let state = "…";
  let treatment: Treatment = "top";
  let tui: TUI | undefined;
  let context: ExtensionContext | undefined;

  const label = (paint: (text: string) => string): string => {
    const prefix = treatment === "top-tf" ? "tf " : "";
    const text = paint(` ${prefix}${state} `);
    if (treatment !== "top-color" || !context) return text;
    return context.ui.theme.fg(stateColor(state), ` ${state} `);
  };

  const withLabel = (width: number, plain: (width: number) => string, paint: (text: string) => string): string => {
    const room = Math.max(0, width - MIN_BORDER - 1);
    if (room < 3) return plain(width);
    const tag = truncateToWidth(label(paint), Math.min(room, Math.floor(width / 2)), "… ");
    return plain(width - visibleWidth(tag) - 1) + tag + paint("─");
  };

  class StateEditor extends CustomEditor {
    constructor(ui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
      super(ui, theme, keybindings, { embedWorkingStatus: true });
      tui = ui;
    }

    protected override renderTopBorder(width: number, hiddenLineCount: number): string {
      if (treatment === "bottom" || treatment === "footer") return super.renderTopBorder(width, hiddenLineCount);
      return withLabel(width, (w) => super.renderTopBorder(w, hiddenLineCount), this.borderColor);
    }

    protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
      if (treatment !== "bottom") return super.renderBottomBorder(width, hiddenLineCount);
      return withLabel(width, (w) => super.renderBottomBorder(w, hiddenLineCount), this.borderColor);
    }
  }

  const render = () => {
    context?.ui.setStatus("tf", treatment === "footer" ? `tf: ${state}` : undefined);
    tui?.requestRender();
  };

  pi.registerCommand("tf-style", {
    description: `Where tf shows its state: ${treatments.join(", ")} (no argument cycles)`,
    getArgumentCompletions: (prefix) =>
      treatments.filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name })),
    handler: async (args, ctx) => {
      const asked = args.trim();
      if (asked && !(treatments as readonly string[]).includes(asked)) {
        ctx.ui.notify(`Unknown style ${asked}. Pick one of: ${treatments.join(", ")}`, "warning");
        return;
      }
      treatment = asked ? (asked as Treatment) : treatments[(treatments.indexOf(treatment) + 1) % treatments.length]!;
      render();
      ctx.ui.notify(`tf style: ${treatment}`, "info");
    },
  });

  return {
    attach: (ctx: ExtensionContext) => {
      context = ctx;
      ctx.ui.setEditorComponent((ui, theme, keybindings) => new StateEditor(ui, theme, keybindings));
    },
    show: (text: string) => {
      state = text.split("\n")[0] ?? text;
      render();
    },
  };
};
