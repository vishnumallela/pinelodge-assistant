#!/usr/bin/env bash
# Free the dev ports before `turbo run dev` starts. Idempotent — silent
# if a port is free; logs when something gets killed.
set -u

PORTS=(3000 3001 3002)

for port in "${PORTS[@]}"; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[kill-ports] :$port -> killing $(echo "$pids" | tr '\n' ' ')"
    kill -9 $pids 2>/dev/null || true
  fi
done
