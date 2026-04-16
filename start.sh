#!/usr/bin/env bash
# OpenGlobe — start both servers
# Usage: ./start.sh
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "==> Stopping any existing OpenGlobe processes..."
fuser -k 8765/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
sleep 1

echo "==> Starting FastAPI server on :8765..."
cd "$SCRIPT_DIR/server"
nohup .venv/bin/uvicorn main:app --port 8765 --host 0.0.0.0 > /tmp/openglobe-server.log 2>&1 &
echo "  FastAPI PID $!"

echo "==> Building and starting Vite client on :5173..."
cd "$SCRIPT_DIR/client"
npm run build 2>&1 | tail -3
nohup npm run preview > /tmp/openglobe-client.log 2>&1 &
echo "  Preview PID $!"

sleep 4
echo ""
echo "  Server log: /tmp/openglobe-server.log"
echo "  Client log: /tmp/openglobe-client.log"
echo ""
echo "  OpenGlobe:  http://10.0.1.14:5173"
echo "  FastAPI:    http://10.0.1.14:8765/docs"
echo ""
echo "  Load Sample_Data:"
echo "  http://10.0.1.14:5173/?project=/home/vagrant2/Projects/Sample_Data/Sample_Data.geolook"
