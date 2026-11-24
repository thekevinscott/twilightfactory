import { EventSourceParserStream } from "eventsource-parser/stream";
import { Agent, fetch } from "undici";
export class Client {
    agent;
    constructor(socketPath) {
        this.agent = new Agent({ connect: { socketPath } });
    }
    send(method, path, body, signal) {
        return fetch(`http://twilightfactory${path}`, {
            method,
            dispatcher: this.agent,
            signal,
            headers: body === undefined ? undefined : { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }
    async reply(method, path, body) {
        const response = await this.send(method, path, body);
        const reply = (await response.json());
        if (!reply.ok) {
            throw new Error(reply.error ?? `the daemon answered ${response.status}`);
        }
        return reply.id ?? "";
    }
    async status() {
        return (await (await this.send("GET", "/status")).json());
    }
    runAction(name) {
        return this.reply("POST", `/actions/${encodeURIComponent(name)}/run`);
    }
    startAgent(prompt) {
        return this.reply("POST", "/agents", { prompt });
    }
    stop() {
        return this.reply("POST", "/stop");
    }
    async log(kind, id) {
        const response = await this.send("GET", `/${kind}/runs/${encodeURIComponent(id)}/log`);
        const text = await response.text();
        if (!response.ok) {
            throw new Error(text);
        }
        return text;
    }
    async *states(signal) {
        const response = await this.send("GET", "/events", undefined, signal);
        if (!response.body) {
            return;
        }
        const events = response.body
            .pipeThrough(new TextDecoderStream())
            .pipeThrough(new EventSourceParserStream());
        for await (const event of events) {
            if (event.event === "state") {
                yield JSON.parse(event.data);
            }
        }
    }
    close() {
        return this.agent.close();
    }
}
