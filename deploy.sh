#!/bin/sh
# Pull the latest code and (re)start the game in Docker.
# Usage: ./deploy.sh          (runs on port 3000)
#        PORT=80 ./deploy.sh  (runs on another port)
set -e
cd "$(dirname "$0")"

git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null

echo ""
echo "IMMU'S CLASH ARENA is running on port ${PORT:-3000}"
echo "Open: http://$(curl -s https://api.ipify.org 2>/dev/null || echo YOUR_SERVER_IP):${PORT:-3000}/?u=immu"
