set shell := ["bash", "-cu"]

default:
    @just --list

install:
    cd packages/state-machine && pnpm install
    cd packages/gh && pnpm install
    cd packages/twilight-factory && pnpm install
    pnpm install --ignore-workspace

lint:
    cd packages/twilight-factory && pnpm run lint

typecheck:
    cd packages/twilight-factory && pnpm run typecheck

build:
    cd packages/state-machine && pnpm run build
    cd packages/gh && pnpm run build
    cd packages/twilight-factory && pnpm run build

# Tests always run in the container; this is the run inside it.
[positional-arguments]
_test-host *args: build
    node_modules/.bin/vitest run --config tests/vitest.config.ts --root . "$@"

[positional-arguments]
test *args:
    just test-docker replay "$@"

# Run the tests in a container whose only way out is a proxy.
# network: replay (answers from each test's fixture), record (real network, JSON saved to tests/docker/recordings), live (real network).
[positional-arguments]
test-docker network="replay" *args:
    #!/usr/bin/env bash
    set -euo pipefail
    shift
    export NETWORK={{network}} HOST_UID=$(id -u) HOST_GID=$(id -g)
    export WORKTREE=$PWD
    export REPOSITORY=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
    export CURTAINCALL=$(realpath node_modules/curtaincall)
    export EGRESS=internet
    [ "$NETWORK" != replay ] || export EGRESS=nowhere
    compose="docker compose -f tests/docker/compose.yaml"
    trash-put tests/docker/.proxy tests/docker/.requests 2>/dev/null || true
    mkdir -p tests/docker/recordings tests/docker/.proxy tests/docker/.requests
    trap '$compose down --volumes --remove-orphans >/dev/null 2>&1; trash-put tests/docker/.proxy tests/docker/.requests 2>/dev/null' EXIT
    $compose run --rm --build tests just _test-host "$@"
