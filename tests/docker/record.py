import json
import pathlib

RECORDINGS = pathlib.Path("/proxy/recordings")


def response(flow):
    if flow.response.status_code != 200 or "json" not in flow.response.headers.get("content-type", ""):
        return
    target = RECORDINGS / f"{flow.request.pretty_host}{flow.request.path.split('?')[0]}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(flow.response.json(), indent=2) + "\n")
