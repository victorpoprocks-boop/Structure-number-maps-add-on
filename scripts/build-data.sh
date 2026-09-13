#!/usr/bin/env bash
# Refresh Illinois bridge inventory from IDOT GIST2 (primary) + optional NBI supplement.
# Use: ./scripts/build-data.sh [--skip-download] [--skip-nbi] ...
# Legacy NBI-only: ./scripts/build-data.sh --nbi-only [--skip-download]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Prefer venv with pyshp if present
PY=python3
if [[ -x /workspace/idot-gis/venv/bin/python ]]; then
  PY=/workspace/idot-gis/venv/bin/python
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
fi

exec "$PY" "$ROOT/scripts/build-data.py" "$@"
