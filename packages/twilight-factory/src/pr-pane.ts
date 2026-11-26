import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type KeyId, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import type { PullRequestStatus } from "twilight-gh";

// Rows of pull requests before the rest fold into "+N more"; the rule under them makes one more.
const MAX_ROWS = 10;

// Free in Pi's built-in keybindings on every platform.
export const PANE_KEY: KeyId = "alt+r";

const stateColor = { open: "accent", merged: "success", closed: "error" } as const;

const shownPulls = (pulls: PullRequestStatus[]) => (pulls.length > MAX_ROWS ? pulls.slice(0, MAX_ROWS - 1) : pulls);

const rows = (pulls: PullRequestStatus[], theme: Theme, selected: number | undefined, width: number): string[] => {
  const numberWidth = Math.max(...pulls.map(pr => `#${pr.number}`.length));
  const shown = shownPulls(pulls);
  const lines = shown.map(pr => {
    const number = theme.fg("dim", `#${pr.number}`.padEnd(numberWidth));
    const state = theme.fg(stateColor[pr.state], pr.state.padEnd(6));
    const draft = pr.draft ? theme.fg("dim", " (draft)") : "";
    const line = ` ${number}  ${state}  ${pr.title}${draft}`;
    return pr.number === selected ? theme.inverse(truncateToWidth(line, width, undefined, true)) : line;
  });
  if (shown.length < pulls.length) { lines.push(theme.fg("dim", ` +${pulls.length - shown.length} more`)); }
  return lines;
};

// Open pull requests and the most recently closed, pinned over the top rows of chat.
export const pullRequestPane = () => {
  let pulls: PullRequestStatus[] = [];
  let error: string | undefined;
  let tui: TUI | undefined;
  let handle: OverlayHandle | undefined;
  let close: (() => void) | undefined;
  // By number, so the highlight follows the pull request across refreshes.
  let selected: number | undefined;

  const focused = () => handle?.isFocused() ?? false;
  const move = (step: number) => {
    const shown = shownPulls(pulls);
    const index = shown.findIndex(pr => pr.number === selected);
    selected = shown[Math.min(Math.max(index + step, 0), shown.length - 1)]?.number;
    tui?.requestRender();
  };

  const empty = () => pulls.length === 0 && error === undefined;
  const update = () => {
    handle?.setHidden(empty());
    tui?.requestRender();
  };

  return {
    attach: (ctx: ExtensionContext) => {
      void ctx.ui.custom<void>(
        (ui, theme, _keybindings, done) => {
          tui = ui;
          close = () => done();
          return {
            invalidate() {
              // Rendering reads live state; nothing is cached.
            },
            handleInput(data: string) {
              if (matchesKey(data, Key.up)) {
                move(-1);
              } else if (matchesKey(data, Key.down)) {
                move(1);
              } else if (matchesKey(data, Key.escape) || matchesKey(data, PANE_KEY)) {
                handle?.unfocus();
              }
            },
            render(width: number): string[] {
              const highlight = focused() ? selected : undefined;
              const lines =
                error === undefined ? rows(pulls, theme, highlight, width) : [theme.fg("error", ` pull requests: ${error}`)];
              return [...lines, theme.fg("borderMuted", "─".repeat(width))].map(line => truncateToWidth(line, width));
            },
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
    // Pi only runs extension shortcuts from the input box, so the pane handles the key itself while focused.
    toggle: () => {
      if (!handle) {
        return;
      }
      if (focused()) {
        handle.unfocus();
      } else {
        if (shownPulls(pulls).every(pr => pr.number !== selected)) {
          selected = shownPulls(pulls)[0]?.number;
        }
        handle.focus();
      }
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
