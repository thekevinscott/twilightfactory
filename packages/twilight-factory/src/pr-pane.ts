import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type KeyId, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import type { PullRequestStatus } from "twilight-gh";

// Chat keeps this many rows (about three turns); the pane gets what is left above it.
const CONVERSATION_ROWS = 20;
// Pi's input box (3) and tf's footer (1).
const CHROME_ROWS = 4;
// On a short terminal the pane shrinks to this, rule included, before chat does.
const MIN_PANE_ROWS = 4;

const paneRows = (terminalRows: number) => Math.max(MIN_PANE_ROWS, terminalRows - CONVERSATION_ROWS - CHROME_ROWS);

// Free in Pi's built-in keybindings on every platform.
export const PANE_KEY: KeyId = "alt+r";

const stateColor = { open: "accent", merged: "success", closed: "error" } as const;

const shownPulls = (pulls: PullRequestStatus[], max: number) =>
  pulls.length > max ? pulls.slice(0, max - 1) : pulls;

const rows = (pulls: PullRequestStatus[], theme: Theme, max: number, selected: number | undefined, width: number): string[] => {
  const numberWidth = Math.max(...pulls.map(pr => `#${pr.number}`.length));
  const shown = shownPulls(pulls, max);
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

// Open pull requests and the most recently closed, pinned to the top of Pi.
// A blank header of the same height keeps chat, and tf's notices, from starting under it.
export const pullRequestPane = () => {
  let pulls: PullRequestStatus[] = [];
  let error: string | undefined;
  let tui: TUI | undefined;
  let handle: OverlayHandle | undefined;
  let close: (() => void) | undefined;
  // By number, so the highlight follows the pull request across refreshes.
  let selected: number | undefined;

  const focused = () => handle?.isFocused() ?? false;
  const shown = () => shownPulls(pulls, paneRows(tui?.terminal.rows ?? 0) - 1);
  const move = (step: number) => {
    const visible = shown();
    const index = visible.findIndex(pr => pr.number === selected);
    selected = visible[Math.min(Math.max(index + step, 0), visible.length - 1)]?.number;
    tui?.requestRender();
  };

  const empty = () => pulls.length === 0 && error === undefined;
  const render = (width: number, height: number, theme: Theme) => {
    const highlight = focused() ? selected : undefined;
    const lines =
      error === undefined
        ? rows(pulls, theme, paneRows(height) - 1, highlight, width)
        : [theme.fg("error", ` pull requests: ${error}`)];
    return [...lines, theme.fg("borderMuted", "─".repeat(width))].map(line => truncateToWidth(line, width));
  };
  const update = () => {
    handle?.setHidden(empty());
    tui?.requestRender();
  };

  return {
    attach: (ctx: ExtensionContext) => {
      ctx.ui.setHeader((ui, theme) => ({
        invalidate() {
          // Rendering reads live state; nothing is cached.
        },
        render: (width: number) => (empty() ? [] : render(width, ui.terminal.rows, theme).map(() => "")),
      }));
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
            render: (width: number) => render(width, ui.terminal.rows, theme),
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
        if (shown().every(pr => pr.number !== selected)) {
          selected = shown()[0]?.number;
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
