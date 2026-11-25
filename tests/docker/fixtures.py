import base64
import json
import pathlib
import urllib.request

from mitmproxy import http

WORKTREE = pathlib.Path("/worktree")
REQUESTS = pathlib.Path("/proxy/.requests")
fixtures = {}
logs = {}


# A test names its fixture as the username in HTTPS_PROXY. The password is either a request log name,
# or `callback.<port>`: each request is then POSTed to that port on the test's own address as it arrives.
def http_connect(flow):
    credentials = flow.request.headers.get("proxy-authorization")
    if credentials:
        fixture, log = base64.b64decode(credentials.split()[1]).decode().rsplit(":", 1)
        fixtures[flow.client_conn.id] = fixture
        logs[flow.client_conn.id] = log


def request(flow):
    log = logs.get(flow.client_conn.id) or ""
    entry = {
        "method": flow.request.method,
        "url": flow.request.pretty_url,
        "authorization": flow.request.headers.get("authorization"),
        "body": flow.request.get_text(),
    }
    if log.startswith("callback."):
        url = f"http://{flow.client_conn.peername[0]}:{log.removeprefix('callback.')}/"
        urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(entry).encode(), method="POST"), timeout=5)
    elif log.isalnum():
        with open(REQUESTS / f"{log}.jsonl", "a") as out:
            out.write(json.dumps(entry) + "\n")
    fixture = fixtures.get(flow.client_conn.id)
    base = WORKTREE / (fixture or "") / f"{flow.request.pretty_host}{flow.request.path.split('?')[0]}"
    # `<path>.json` answers 200; `<path>.<status>.json` answers with that status.
    matches = [(200, base.with_name(base.name + ".json"))] + [
        (int(file.name[len(base.name) + 1 : -5]), file)
        for file in (base.parent.glob(f"{base.name}.[0-9][0-9][0-9].json") if base.parent.is_dir() else [])
    ]
    found = [(status, file) for status, file in matches if file.is_file()]
    if fixture and found:
        status, file = found[0]
        flow.response = http.Response.make(status, file.read_bytes(), {"content-type": "application/json"})
    else:
        flow.response = http.Response.make(502, f"no fixture for {flow.request.pretty_url}")
