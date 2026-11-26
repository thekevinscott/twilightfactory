import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import type { PullRequestStatus } from "twilight-gh";

// Rows of pull requests before the rest fold into "+N more"; the rule under them makes one more.
const MAX_ROWS = 10;

const stateColor = { open: "accent", merged: "success", closed: "error" } as const;

const rows = (pulls: PullRequestStatus[], theme: Theme): string[] => {
  const numberWidth = Math.max(...pulls.map(pr => `#${pr.number}`.length));
  const shown = pulls.length > MAX_ROWS ? pulls.slice(0, MAX_ROWS - 1) : pulls;
  const lines = shown.map(pr => {
    const number = theme.fg("dim", `#${pr.number}`.padEnd(numberWidth));
    const state = theme.fg(stateColor[pr.state], pr.state.padEnd(6));
    const draft = pr.draft ? theme.fg("dim", " (draft)") : "";
    return ` ${number}  ${state}  ${pr.title}${draft}`;
  });
  if (shown.length < pulls.length) { lines.push(theme.fg("dim", ` +${pulls.length - shown.length} more`)); }
  return lines;
};

// Open pull requests and the most recently closed, pinned to the top of Pi.
// A blank header of the same height keeps chat, and tf's notices, from starting under it.
export const pullRequestPane = () => {
  let pulls: PullRequestStatus[] = [];
  let error: string | undefined;
  let tui: TUI | undefined;
  let handle: OverlayHandle | undefined;
  let close: (() => void) | undefined;

  const empty = () => pulls.length === 0 && error === undefined;
  const render = (width: number, theme: Theme) => {
    const lines = error === undefined ? rows(pulls, theme) : [theme.fg("error", ` pull requests: ${error}`)];
    return [...lines, theme.fg("borderMuted", "─".repeat(width))].map(line => truncateToWidth(line, width));
  };
  const update = () => {
    handle?.setHidden(empty());
    tui?.requestRender();
  };

  return {
    attach: (ctx: ExtensionContext) => {
      ctx.ui.setHeader((_ui, theme) => ({
        invalidate() {
          // Rendering reads live state; nothing is cached.
        },
        render: (width: number) => (empty() ? [] : render(width, theme).map(() => "")),
      }));
      void ctx.ui.custom<void>(
        (ui, theme, _keybindings, done) => {
          tui = ui;
          close = () => done();
          return {
            invalidate() {
              // Rendering reads live state; nothing is cached.
            },
            render: (width: number) => render(width, theme),
          };
        },
        {
          overlay: true,
          overlayOptions: { anchor: "top-center", width: "100%", nonCapturing: true },
          onHandle: overlay => {
            handle = overlay;
            overlay.setHidden(empty());
          },
        },
      );
    },
    show: (next: PullRequestStatus[]) => {
      pulls = next;
      error = undefined;
      update();
    },
    fail: (message: string) => {
      error = message;
      update();
    },
    dispose: () => {
      handle?.hide();
      close?.();
      handle = undefined;
      close = undefined;
      tui = undefined;
    },
  };
};
