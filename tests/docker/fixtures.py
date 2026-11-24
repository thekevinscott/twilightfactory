import base64
import json
import pathlib

from mitmproxy import http

WORKTREE = pathlib.Path("/worktree")
REQUESTS = pathlib.Path("/proxy/.requests")
fixtures = {}
logs = {}


# A test names its fixture as the username in HTTPS_PROXY, and may name a request log as the password.
def http_connect(flow):
    credentials = flow.request.headers.get("proxy-authorization")
    if credentials:
        fixture, log = base64.b64decode(credentials.split()[1]).decode().rsplit(":", 1)
        fixtures[flow.client_conn.id] = fixture
        logs[flow.client_conn.id] = log


def request(flow):
    log = logs.get(flow.client_conn.id)
    if log and log.isalnum():
        entry = {"method": flow.request.method, "url": flow.request.pretty_url, "authorization": flow.request.headers.get("authorization")}
        with open(REQUESTS / f"{log}.jsonl", "a") as out:
            out.write(json.dumps(entry) + "\n")
    fixture = fixtures.get(flow.client_conn.id)
    file = WORKTREE / (fixture or "") / f"{flow.request.pretty_host}{flow.request.path.split('?')[0]}.json"
    if fixture and file.is_file():
        flow.response = http.Response.make(200, file.read_bytes(), {"content-type": "application/json"})
    else:
        flow.response = http.Response.make(502, f"no fixture for {flow.request.pretty_url}")
