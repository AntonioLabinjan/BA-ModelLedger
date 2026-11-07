#!/usr/bin/env bash
# Starts a local chain + backend, deploys the contract, runs the e2e workflow, then cleans up.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export LOCAL_STORE_DIR="$TMP/store"
cleanup() { kill "${PIDS[@]}" 2>/dev/null || true; rm -rf "$TMP"; }
PIDS=(); trap cleanup EXIT

cd "$ROOT/contracts"
npx hardhat node >"$TMP/node.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 40); do curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://127.0.0.1:8545 >/dev/null && break; sleep 0.5; done
npm run -s deploy
cd "$ROOT/backend"
python3 -m uvicorn app.main:app --port 8000 >"$TMP/api.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 40); do curl -s http://127.0.0.1:8000/api/health >/dev/null && break; sleep 0.5; done
echo "health: $(curl -s http://127.0.0.1:8000/api/health)"
python3 "$ROOT/scripts/e2e.py" || { echo "--- api.log ---"; tail -20 "$TMP/api.log"; exit 1; }
