set shell := ["bash", "-cu"]

# harnessmd is not published yet, so the default is the local checkout.
harnessmd := env("HARNESSMD", home_directory() / "work/code/research/harnessmd/packages/node/dist/cli.js")

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
_test-host *args: build
    node -e "fs.rmSync('.harnessmd', { recursive: true, force: true })"
    node {{harnessmd}} --input tests --language typescript "node_modules/.bin/vitest run --config tests/vitest.config.ts --root . {{args}}"

test *args:
    just test-docker replay {{args}}

# Run the tests in a container whose only way out is a proxy.
# network: replay (answers from each test's fixture), record (real network, JSON saved to tests/docker/recordings), live (real network).
test-docker network="replay" *args:
    #!/usr/bin/env bash
    set -euo pipefail
    export NETWORK={{network}} HOST_UID=$(id -u) HOST_GID=$(id -g)
    export WORKTREE=$PWD
    export REPOSITORY=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
    export HARNESSMD=$(realpath "$(dirname {{harnessmd}})/../../..")
    export CURTAINCALL=$(realpath node_modules/curtaincall)
    export EGRESS=internet
    [ "$NETWORK" != replay ] || export EGRESS=nowhere
    compose="docker compose -f tests/docker/compose.yaml"
    trash-put tests/docker/.proxy tests/docker/.requests 2>/dev/null || true
    mkdir -p tests/docker/recordings tests/docker/.proxy tests/docker/.requests
    trap '$compose down --volumes --remove-orphans >/dev/null 2>&1; trash-put tests/docker/.proxy tests/docker/.requests 2>/dev/null' EXIT
    $compose run --rm --build tests just _test-host {{args}}
