# test-proxy

An HTTPS proxy for tests whose code under test runs in a child process, so in-process mocks (nock, MSW) can't reach it. Built on [mockttp](https://github.com/httptoolkit/mockttp), which does the TLS interception and per-request events.

```ts
import { launch, startProxy } from "test-proxy";

const proxy = await startProxy();                   // { mode: "record", recordings: dir } or { mode: "live" } to pass through
const session = proxy.session("tests/fixtures/run"); // a fixture folder; each session sees only its own traffic
launch(terminal, ["node", "cli.js"], session, { env: { GH_TOKEN: "x" } });
const dispatch = await session.next(({ method }) => method === "POST");
session.requests;                                    // [{ method, url, authorization, body }]
await proxy.stop();
```

Fixture folders hold `<host>/<path>.json` (answers 200) and `<host>/<path>.<status>.json` (answers that status). The query string is ignored. A request with no fixture gets a 502 naming the URL.

`session.env` sets `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_USE_ENV_PROXY`, `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`, which covers Node, curl and Go programs like `gh`. The proxy tells sessions apart by mockttp's `metadata` proxy credentials, so one proxy serves every test in a file.
