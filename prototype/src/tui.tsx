import { Box, Text, render, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { useEffect, useState } from "react";
import type { Client } from "./daemon/client.js";
import { actionLine, agentLine, eventLine, headLine } from "./status.js";
import type { Snapshot } from "./types.js";

type Pane = "runs" | "agents";
type Mode = "lists" | "pick" | "prompt" | "log";

const ROWS = { events: 8, runs: 8, agents: 5 };

function List(props: { title: string; lines: string[]; selected: number | null; rows: number }) {
  const first = Math.max(0, (props.selected ?? 0) - props.rows + 1);
  const shown = props.lines.slice(first, first + props.rows);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{props.title}</Text>
      {shown.length === 0 && <Text dimColor>  none</Text>}
      {shown.map((line, index) => {
        const chosen = props.selected === first + index;
        return (
          <Text key={line} inverse={chosen} wrap="truncate">
            {chosen ? "> " : "  "}
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function App({ client }: { client: Client }) {
  const { exit } = useApp();
  const [state, setState] = useState<Snapshot | null>(null);
  const [mode, setMode] = useState<Mode>("lists");
  const [pane, setPane] = useState<Pane>("runs");
  const [chosen, setChosen] = useState({ runs: 0, agents: 0 });
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState({ title: "", text: "" });
  const [note, setNote] = useState("");

  useEffect(() => {
    const stopping = new AbortController();
    void (async () => {
      try {
        for await (const next of client.states(stopping.signal)) {
          setState(next);
        }
        setNote("the daemon stopped");
      } catch (error) {
        if (!stopping.signal.aborted) {
          setNote(`lost the daemon: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
    return () => stopping.abort();
  }, [client]);

  const report = (work: Promise<string>, done: (id: string) => string) => {
    work.then((id) => setNote(done(id))).catch((error: Error) => setNote(error.message));
  };

  const openLog = () => {
    const kind = pane === "runs" ? "actions" : "agents";
    const run = pane === "runs" ? state?.action_runs[chosen.runs] : state?.agents[chosen.agents];
    if (!run) {
      return;
    }
    client
      .log(kind, run.id)
      .then((text) => {
        setLog({ title: `${kind} ${run.id}`, text });
        setMode("log");
      })
      .catch((error: Error) => setNote(error.message));
  };

  useInput((input, key) => {
    if (mode === "log" || mode === "pick") {
      if (key.escape || input === "q") {
        setMode("lists");
      }
      return;
    }
    if (mode === "prompt") {
      if (key.escape) {
        setMode("lists");
      }
      return;
    }
    const count = pane === "runs" ? (state?.action_runs.length ?? 0) : (state?.agents.length ?? 0);
    const move = (by: number) =>
      setChosen({ ...chosen, [pane]: Math.min(Math.max(chosen[pane] + by, 0), Math.max(count - 1, 0)) });
    if (input === "q") {
      exit();
    } else if (key.tab) {
      setPane(pane === "runs" ? "agents" : "runs");
    } else if (key.upArrow || input === "k") {
      move(-1);
    } else if (key.downArrow || input === "j") {
      move(1);
    } else if (input === "r") {
      if (state?.actions.length) {
        setMode("pick");
      } else {
        setNote("no actions in twilightfactory.toml");
      }
    } else if (input === "a") {
      setPrompt("");
      setMode("prompt");
    } else if (input === "l" || key.return) {
      openLog();
    }
  });

  if (!state) {
    return <Text>{note || "connecting to the daemon"}</Text>;
  }

  if (mode === "log") {
    const rows = Math.max((process.stdout.rows ?? 30) - 4, 5);
    return (
      <Box flexDirection="column">
        <Text bold>{log.title}</Text>
        <Text>{log.text.trimEnd().split("\n").slice(-rows).join("\n") || "(empty)"}</Text>
        <Text dimColor>esc back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {headLine(state)}
      </Text>
      <List title="events" lines={state.events.map(eventLine)} selected={null} rows={ROWS.events} />
      <List
        title={pane === "runs" ? "action runs *" : "action runs"}
        lines={state.action_runs.map(actionLine)}
        selected={pane === "runs" ? chosen.runs : null}
        rows={ROWS.runs}
      />
      <List
        title={pane === "agents" ? "agents *" : "agents"}
        lines={state.agents.map(agentLine)}
        selected={pane === "agents" ? chosen.agents : null}
        rows={ROWS.agents}
      />
      {mode === "pick" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>run which action (esc cancels)</Text>
          <SelectInput
            items={state.actions.map((action) => ({ label: `${action.name}: ${action.command}`, value: action.name }))}
            onSelect={(item) => {
              setMode("lists");
              report(client.runAction(item.value), (id) => `started ${item.value} (${id})`);
            }}
          />
        </Box>
      )}
      {mode === "prompt" && (
        <Box marginTop={1}>
          <Text bold>agent prompt (enter starts, esc cancels): </Text>
          <TextInput
            value={prompt}
            onChange={setPrompt}
            onSubmit={(typed) => {
              setMode("lists");
              report(client.startAgent(typed), (id) => `agent worktree created (${id})`);
            }}
          />
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor wrap="truncate">
          {note ? `${note}  |  ` : ""}r run action  a agent  tab pane  j/k move  l log  q quit
        </Text>
      </Box>
    </Box>
  );
}

export async function runTui(client: Client): Promise<void> {
  const app = render(<App client={client} />);
  await app.waitUntilExit();
}
