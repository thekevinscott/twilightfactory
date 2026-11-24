import base64
import pathlib

from mitmproxy import http

WORKTREE = pathlib.Path("/worktree")
fixtures = {}


# A test names its fixture as the username in HTTPS_PROXY.
def http_connect(flow):
    credentials = flow.request.headers.get("proxy-authorization")
    if credentials:
        fixtures[flow.client_conn.id] = base64.b64decode(credentials.split()[1]).decode().rsplit(":", 1)[0]


def request(flow):
    fixture = fixtures.get(flow.client_conn.id)
    file = WORKTREE / (fixture or "") / f"{flow.request.pretty_host}{flow.request.path.split('?')[0]}.json"
    if fixture and file.is_file():
        flow.response = http.Response.make(200, file.read_bytes(), {"content-type": "application/json"})
    else:
        flow.response = http.Response.make(502, f"no fixture for {flow.request.pretty_url}")
