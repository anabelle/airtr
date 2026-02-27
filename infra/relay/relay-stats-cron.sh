#!/bin/sh
# relay-stats-cron.sh — Generates /tmp/relay-stats.json every minute
# Install: crontab -e -> * * * * * /home/pixel/pixel/nostr-relay/relay-stats-cron.sh
#
# This file is read by nginx to serve GET /stats on the relay domain.

CONTAINER="strfry-relay"
OUT="/home/pixel/pixel/nostr-relay/stats.json"

status=$(docker inspect -f '{{.State.Status}}' $CONTAINER 2>/dev/null || echo "not found")
health=$(docker inspect -f '{{.State.Health.Status}}' $CONTAINER 2>/dev/null || echo "unknown")
started=$(docker inspect -f '{{.State.StartedAt}}' $CONTAINER 2>/dev/null || echo "unknown")

if [ "$status" = "running" ]; then
    total=$(docker exec $CONTAINER /app/strfry scan --count '{}' 2>/dev/null | grep -E '^[0-9]+$' || echo 0)
    actions=$(docker exec $CONTAINER /app/strfry scan --count '{"kinds":[30078]}' 2>/dev/null | grep -E '^[0-9]+$' || echo 0)
    market=$(docker exec $CONTAINER /app/strfry scan --count '{"kinds":[30079]}' 2>/dev/null | grep -E '^[0-9]+$' || echo 0)
    db_bytes=$(du -sb /home/pixel/pixel/nostr-relay/data 2>/dev/null | cut -f1 || echo 0)
    mem=$(docker stats $CONTAINER --no-stream --format '{{.MemUsage}}' 2>/dev/null || echo "unknown")
else
    total=0
    actions=0
    market=0
    db_bytes=0
    mem="N/A"
fi

disk_free_bytes=$(df -B1 /home/pixel/pixel/nostr-relay/data 2>/dev/null | tail -1 | awk '{print $4}' || echo 0)
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$OUT" <<EOF
{
  "relay": "wss://nostr.acars.pub",
  "status": "$status",
  "health": "$health",
  "started_at": "$started",
  "updated_at": "$ts",
  "events": {
    "total": $total,
    "game_actions": $actions,
    "marketplace": $market
  },
  "storage": {
    "db_bytes": $db_bytes,
    "disk_free_bytes": $disk_free_bytes
  },
  "memory": "$mem"
}
EOF
