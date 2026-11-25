import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Spike for #68: what Pi lets an extension draw. Not a feature.
export const showSpikeUI = (ctx: ExtensionContext) => {
  ctx.ui.setWidget("tf-spike-foo", ["FOO WIDGET"], { placement: "aboveEditor" });

  void ctx.ui.custom(
    (_tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const inner = Math.max(0, width - 2);
        const text = truncateToWidth(" TOP PANE (non-capturing overlay, anchor top-center)", inner);
        const pad = " ".repeat(Math.max(0, inner - visibleWidth(text)));
        return [
          theme.fg("accent", `┌${"─".repeat(inner)}┐`),
          theme.fg("accent", "│") + theme.bold(text) + pad + theme.fg("accent", "│"),
          theme.fg("accent", `└${"─".repeat(inner)}┘`),
        ];
      },
    }),
    { overlay: true, overlayOptions: { anchor: "top-center", width: "100%", nonCapturing: true } },
  );
};
