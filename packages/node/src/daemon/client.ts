import { EventSourceParserStream } from "eventsource-parser/stream";
import { Agent, fetch } from "undici";
import type { Reply, Snapshot } from "../types.js";

export class Client {
  private readonly agent: Agent;

  constructor(socketPath: string) {
    this.agent = new Agent({ connect: { socketPath } });
  }

  private send(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    return fetch(`http://twilightfactory${path}`, {
      method,
      dispatcher: this.agent,
      signal,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async reply(method: string, path: string, body?: unknown): Promise<string> {
    const response = await this.send(method, path, body);
    const reply = (await response.json()) as Reply;
    if (!reply.ok) {
      throw new Error(reply.error ?? `the daemon answered ${response.status}`);
    }
    return reply.id ?? "";
  }

  async status(): Promise<Snapshot> {
    return (await (await this.send("GET", "/status")).json()) as Snapshot;
  }

  runAction(name: string): Promise<string> {
    return this.reply("POST", `/actions/${encodeURIComponent(name)}/run`);
  }

  startAgent(prompt: string): Promise<string> {
    return this.reply("POST", "/agents", { prompt });
  }

  stop(): Promise<string> {
    return this.reply("POST", "/stop");
  }

  async log(kind: "actions" | "agents", id: string): Promise<string> {
    const response = await this.send("GET", `/${kind}/runs/${encodeURIComponent(id)}/log`);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text);
    }
    return text;
  }

  async *states(signal: AbortSignal): AsyncGenerator<Snapshot> {
    const response = await this.send("GET", "/events", undefined, signal);
    if (!response.body) {
      return;
    }
    const events = (response.body as unknown as ReadableStream<Uint8Array>)
      .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>)
      .pipeThrough(new EventSourceParserStream());
    for await (const event of events as unknown as AsyncIterable<{ event?: string; data: string }>) {
      if (event.event === "state") {
        yield JSON.parse(event.data) as Snapshot;
      }
    }
  }

  close(): Promise<void> {
    return this.agent.close();
  }
}
