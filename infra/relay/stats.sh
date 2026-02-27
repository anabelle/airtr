#!/usr/bin/env bash
# stats.sh — Show ACARS relay statistics
#
# Usage:
#   ./stats.sh              # Run locally via SSH to VPS
#   ./stats.sh --local      # Run directly on the VPS (no SSH)
#   ./stats.sh --json       # Output as JSON (for HTTP endpoint)

set -euo pipefail

VPS_HOST="pixel@65.181.125.80"
CONTAINER="strfry-relay"

run_on_vps=true
json_output=false

for arg in "$@"; do
    case "$arg" in
        --local) run_on_vps=false ;;
        --json)  json_output=true ;;
    esac
done

# Helper: run a command either locally or via SSH
cmd() {
    if [ "$run_on_vps" = "true" ]; then
        ssh "$VPS_HOST" "$*"
    else
        eval "$*"
    fi
}

# Gather stats
container_status=$(cmd "docker inspect -f '{{.State.Status}}' $CONTAINER 2>/dev/null" || echo "not found")
container_uptime=$(cmd "docker inspect -f '{{.State.StartedAt}}' $CONTAINER 2>/dev/null" || echo "unknown")
health=$(cmd "docker inspect -f '{{.State.Health.Status}}' $CONTAINER 2>/dev/null" || echo "unknown")

if [ "$container_status" = "running" ]; then
    total_events=$(cmd "docker exec $CONTAINER /app/strfry scan --count '{}' 2>/dev/null | grep -E '^[0-9]+$'" || echo "0")
    kind_30078=$(cmd "docker exec $CONTAINER /app/strfry scan --count '{\"kinds\":[30078]}' 2>/dev/null | grep -E '^[0-9]+$'" || echo "0")
    kind_30079=$(cmd "docker exec $CONTAINER /app/strfry scan --count '{\"kinds\":[30079]}' 2>/dev/null | grep -E '^[0-9]+$'" || echo "0")
    db_size=$(cmd "du -sh /home/pixel/pixel/nostr-relay/data 2>/dev/null | cut -f1" || echo "unknown")
    mem_usage=$(cmd "docker stats $CONTAINER --no-stream --format '{{.MemUsage}}' 2>/dev/null" || echo "unknown")
    connections=$(cmd "docker exec $CONTAINER sh -c 'ls /proc/1/fd 2>/dev/null | wc -l'" || echo "unknown")
else
    total_events=0
    kind_30078=0
    kind_30079=0
    db_size="N/A"
    mem_usage="N/A"
    connections="N/A"
fi

disk_free=$(cmd "df -h /home/pixel/pixel/nostr-relay/data 2>/dev/null | tail -1 | awk '{print \$4}'" || echo "unknown")

if [ "$json_output" = "true" ]; then
    cat <<EOF
{
  "status": "$container_status",
  "health": "$health",
  "started_at": "$container_uptime",
  "total_events": $total_events,
  "kind_30078_game_state": $kind_30078,
  "kind_30079_marketplace": $kind_30079,
  "db_size": "$db_size",
  "memory_usage": "$mem_usage",
  "disk_free": "$disk_free"
}
EOF
else
    echo ""
    echo "  ACARS Relay Stats — nostr.acars.pub"
    echo "  ======================================="
    echo ""
    echo "  Status:       $container_status ($health)"
    echo "  Started:      $container_uptime"
    echo "  Memory:       $mem_usage"
    echo ""
    echo "  Events"
    echo "  -------"
    echo "  Total:        $total_events"
    echo "  Game state:   $kind_30078 (kind 30078)"
    echo "  Marketplace:  $kind_30079 (kind 30079)"
    echo ""
    echo "  Storage"
    echo "  -------"
    echo "  DB size:      $db_size"
    echo "  Disk free:    $disk_free"
    echo ""
fi
