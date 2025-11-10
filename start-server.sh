#!/bin/bash

# KETI TSN Management System - Server Startup Script
# ====================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║  KETI TSN Management System                          ║"
echo "║  LAN966x VelocityDRIVE Web Control Server           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if mvdct exists
if [ ! -f "./mvdct" ]; then
    echo -e "${RED}✗ Error: mvdct CLI not found${NC}"
    echo "  Please ensure mvdct is in the current directory"
    exit 1
fi

# Check if device is connected
if [ ! -e "/dev/ttyACM0" ]; then
    echo -e "${YELLOW}⚠ Warning: /dev/ttyACM0 not found${NC}"
    echo "  Please connect the LAN966x board"
    echo "  Server will start but device operations will fail"
    echo ""
fi

# Kill any existing node servers
echo -e "${YELLOW}🔄 Cleaning up existing servers...${NC}"
killall -9 node 2>/dev/null || true
sleep 1

# Check if port 8080 is available
if lsof -i :8080 >/dev/null 2>&1; then
    echo -e "${RED}✗ Port 8080 is already in use${NC}"
    echo "  Please stop the process using port 8080"
    lsof -i :8080
    exit 1
fi

# Create board-data directory if it doesn't exist
mkdir -p board-data
echo -e "${GREEN}✓ Board data directory ready${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js found: $(node --version)${NC}"

# Start the server
echo ""
echo -e "${BLUE}🚀 Starting KETI TSN Management Server...${NC}"
echo ""
echo -e "${GREEN}📡 Device: ${NC}/dev/ttyACM0"
echo -e "${GREEN}🔧 mvdct: ${NC}$SCRIPT_DIR/mvdct"
echo -e "${GREEN}🌐 Server: ${NC}http://localhost:8080"
echo -e "${GREEN}🌐 Network: ${NC}http://$(hostname -I | awk '{print $1}'):8080"
echo -e "${GREEN}📊 Polling: ${NC}Every 15s (basic data)"
echo -e "${GREEN}📊 Full YANG: ${NC}Every 30s"
echo -e "${GREEN}💾 Storage: ${NC}$SCRIPT_DIR/board-data"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo "─────────────────────────────────────────────────────"
echo ""

# Start server with output to both console and log
LOG_FILE="/tmp/tsn-keti-server.log"
node web-server.js 2>&1 | tee "$LOG_FILE"
