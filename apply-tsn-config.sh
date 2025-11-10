#!/bin/bash

# TSN Configuration Application Script
# Applies complete CBS, VLAN, and PCP mapping configuration to LAN966x board

MVDCT="/home/kim/Downloads/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12/mvdct"
DEVICE="/dev/ttyACM0"
CONFIG_FILE="tsn-config.yaml"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  TSN Configuration Application                       ║"
echo "║  LAN966x Board Configuration Script                 ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check if device exists
if [ ! -e "$DEVICE" ]; then
    echo "❌ Error: Device $DEVICE not found!"
    echo "   Please connect the LAN966x board via USB."
    exit 1
fi

echo "📡 Device: $DEVICE"
echo "📄 Config: $CONFIG_FILE"
echo ""

# Change to mvdct directory
cd "$(dirname "$MVDCT")" || exit 1

echo "🔧 Applying TSN Configuration..."
echo ""

# Apply configuration using IPATCH
echo "📝 Applying configuration from YAML file..."
"$MVDCT" device "$DEVICE" patch "$CONFIG_FILE" --console

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Configuration applied successfully!"
    echo ""
    echo "📊 Configuration Summary:"
    echo "   - CBS: Interface 8 (TC1, 10000), Interface 9 (TC7, 50000)"
    echo "   - VLAN 100: Ports 8,9,10,11 (all tagged)"
    echo "   - PCP Mapping: All ports enabled (8P0D)"
    echo "   - Port Type: C-VLAN bridge port"
    echo "   - Ingress Filtering: Enabled on all ports"
else
    echo ""
    echo "❌ Configuration failed!"
    echo "   Please check the error messages above."
    exit 1
fi

echo ""
echo "🎉 Done!"
