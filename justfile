set shell := ["bash", "-cu"]

# harnessmd is not published yet, so the default is the local checkout.
harnessmd := env("HARNESSMD", home_directory() / "work/code/research/harnessmd/packages/node/dist/cli.js")

default:
    @just --list

install:
    cd packages/node && pnpm install
    pnpm install --ignore-workspace

lint:
    cd packages/node && pnpm run lint

typecheck:
    cd packages/node && pnpm run typecheck

build:
    cd packages/node && pnpm run build

test *args: build
    node {{harnessmd}} --input tests --language typescript "node_modules/.bin/vitest run --config tests/vitest.config.ts --root . {{args}}"
