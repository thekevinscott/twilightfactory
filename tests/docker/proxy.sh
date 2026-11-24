#!/bin/sh
set -eu
case "$1" in
  live) exec mitmdump --quiet ;;
  record) exec mitmdump --quiet --scripts /proxy/record.py ;;
  replay) exec mitmdump --quiet --set connection_strategy=lazy --scripts /proxy/fixtures.py ;;
  *) echo "unknown network mode: $1" >&2; exit 2 ;;
esac
