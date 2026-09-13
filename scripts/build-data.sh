#!/usr/bin/env bash
# Refresh Illinois bridge inventory from FHWA NBI and sync into extension/web.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "$ROOT/scripts/build-data.py" "$@"
