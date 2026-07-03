#!/usr/bin/env sh
set -eu

SERVICE="${SERVICE:-tg_discord_bot}"

if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
else
    echo "Docker Compose is not installed." >&2
    exit 1
fi

cd "$(dirname "$0")"

echo "Building ${SERVICE}..."
$COMPOSE build "$SERVICE"

echo "Restarting ${SERVICE}..."
$COMPOSE up -d --remove-orphans "$SERVICE"

echo "Done."
