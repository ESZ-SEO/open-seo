#!/bin/sh
# Entrypoint for Dockerfile.selfhost.render: starts the renderer microservice
# in the background, then runs the ORIGINAL app entrypoint (docker-entrypoint.sh,
# unmodified, already present in the base image) in the foreground. Both
# processes share this one container.
set -e

RENDERER_PORT="${RENDERER_INTERNAL_PORT:-3100}"

echo "[combined] starting renderer microservice on port ${RENDERER_PORT}..."
PORT="$RENDERER_PORT" node /app/renderer/dist/server.js &
RENDERER_PID=$!

# Forward termination to the renderer too — otherwise `docker stop` only
# reaches the foreground app process (docker-entrypoint.sh's final `exec`)
# and the renderer is left running until the container is force-killed.
trap 'echo "[combined] stopping renderer (pid $RENDERER_PID)..."; kill "$RENDERER_PID" 2>/dev/null' TERM INT

# The app now talks to the renderer over localhost inside this same
# container — default RENDERER_URL here so operators don't have to set it.
# An explicit RENDERER_URL (e.g. pointing at an external renderer/Steel
# Browser later) still wins.
export RENDERER_URL="${RENDERER_URL:-http://localhost:${RENDERER_PORT}}"

sh /app/docker-entrypoint.sh
