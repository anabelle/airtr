#!/usr/bin/env bash
# deploy.sh — Deploy or update the ACARS Nostr relay on the VPS
#
# Usage:
#   ./deploy.sh                  # Deploy with defaults
#   ./deploy.sh --restart        # Force restart the relay container
#   ./deploy.sh --initial-setup  # First-time setup (creates data dir, obtains SSL cert)
#
# Prerequisites:
#   - SSH access to pixel@65.181.125.80
#   - The pixel_pixel-net Docker network must exist on the VPS
#   - For initial setup: certbot image available, Cloudflare DNS configured

set -euo pipefail

VPS_HOST="pixel@65.181.125.80"
VPS_RELAY_DIR="/home/pixel/pixel/nostr-relay"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[relay]${NC} $*"; }
warn() { echo -e "${YELLOW}[relay]${NC} $*"; }
err()  { echo -e "${RED}[relay]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Initial setup (first-time only)
# ---------------------------------------------------------------------------
initial_setup() {
    log "Running initial setup..."

    # Create data directory
    ssh "$VPS_HOST" "mkdir -p ${VPS_RELAY_DIR}/data"

    # Obtain SSL certificate (requires DNS already pointing to VPS)
    log "Obtaining SSL certificate for nostr.acars.pub..."
    ssh "$VPS_HOST" "docker run --rm \
        -v /home/pixel/pixel/certbot/conf:/etc/letsencrypt \
        -v /home/pixel/pixel/certbot/www:/var/www/certbot \
        certbot/certbot certonly \
        --webroot -w /var/www/certbot \
        -d nostr.acars.pub \
        --non-interactive --agree-tos \
        -m noreply@acars.pub" || {
            warn "Certbot failed — cert may already exist. Continuing..."
        }

    log "Initial setup complete."
}

# ---------------------------------------------------------------------------
# Deploy configs
# ---------------------------------------------------------------------------
deploy_configs() {
    log "Syncing relay configs to VPS..."

    # Ensure target directory exists
    ssh "$VPS_HOST" "mkdir -p ${VPS_RELAY_DIR}"

    # Sync config files (not data — that's persistent on VPS)
    scp "${SCRIPT_DIR}/strfry.conf" "${VPS_HOST}:${VPS_RELAY_DIR}/strfry.conf"
    scp "${SCRIPT_DIR}/write-policy.sh" "${VPS_HOST}:${VPS_RELAY_DIR}/write-policy.sh"
    scp "${SCRIPT_DIR}/docker-compose.yml" "${VPS_HOST}:${VPS_RELAY_DIR}/docker-compose.yml"

    # Ensure write-policy.sh is executable
    ssh "$VPS_HOST" "chmod +x ${VPS_RELAY_DIR}/write-policy.sh"

    log "Configs synced."
}

# ---------------------------------------------------------------------------
# Start or restart the relay
# ---------------------------------------------------------------------------
start_relay() {
    local force_restart="${1:-false}"

    # Check if container exists and is running
    local status
    status=$(ssh "$VPS_HOST" "docker inspect -f '{{.State.Status}}' strfry-relay 2>/dev/null" || echo "missing")

    if [ "$status" = "running" ] && [ "$force_restart" = "false" ]; then
        log "Relay is already running. Use --restart to force restart."
        return 0
    fi

    if [ "$status" != "missing" ]; then
        log "Stopping existing relay container..."
        ssh "$VPS_HOST" "cd ${VPS_RELAY_DIR} && docker compose down 2>/dev/null || docker stop strfry-relay && docker rm strfry-relay" || true
    fi

    log "Starting relay via docker compose..."
    ssh "$VPS_HOST" "cd ${VPS_RELAY_DIR} && docker compose up -d"

    # Wait for health check
    log "Waiting for relay to be healthy..."
    local attempts=0
    while [ $attempts -lt 10 ]; do
        local health
        health=$(ssh "$VPS_HOST" "docker inspect -f '{{.State.Health.Status}}' strfry-relay 2>/dev/null" || echo "unknown")
        if [ "$health" = "healthy" ]; then
            log "Relay is healthy!"
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 3
    done

    warn "Relay did not become healthy in 30s, but may still be starting..."
}

# ---------------------------------------------------------------------------
# Verify relay is responding
# ---------------------------------------------------------------------------
verify() {
    log "Verifying relay..."
    local response
    response=$(curl -sf -H "Accept: application/nostr+json" https://nostr.acars.pub/ 2>/dev/null) || {
        err "Relay is not responding at wss://nostr.acars.pub"
        return 1
    }
    log "NIP-11 response: ${response}"
    log "Relay is live at wss://nostr.acars.pub"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    local restart=false
    local setup=false

    for arg in "$@"; do
        case "$arg" in
            --restart) restart=true ;;
            --initial-setup) setup=true ;;
            --help|-h)
                echo "Usage: $0 [--restart] [--initial-setup]"
                exit 0
                ;;
            *) err "Unknown argument: $arg"; exit 1 ;;
        esac
    done

    if [ "$setup" = "true" ]; then
        initial_setup
    fi

    deploy_configs
    start_relay "$restart"
    verify
}

main "$@"
