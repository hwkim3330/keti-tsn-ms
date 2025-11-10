#!/bin/bash

# Get Full YANG Data from LAN966x Board
# Usage: ./get-full-yang.sh [device] [output-file]

MVDCT="/home/kim/Downloads/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12/mvdct"
DEVICE="${1:-/dev/ttyACM0}"
OUTPUT_FILE="${2:-full-yang-data.yaml}"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  LAN966x Full YANG Data Retrieval                   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check if device exists
if [ ! -e "$DEVICE" ]; then
    echo "❌ Error: Device $DEVICE not found!"
    echo ""
    echo "Available options:"
    echo "  - USB: /dev/ttyACM0, /dev/ttyACM1, etc."
    echo "  - IP:  192.168.1.100, etc."
    echo ""
    echo "Usage: $0 [device] [output-file]"
    echo "Example: $0 /dev/ttyACM0 output.yaml"
    echo "Example: $0 192.168.1.100 output.yaml"
    exit 1
fi

echo "📡 Device: $DEVICE"
echo "📄 Output: $OUTPUT_FILE"
echo ""

# Change to mvdct directory
cd "$(dirname "$MVDCT")" || exit 1

echo "🔍 Fetching full YANG data tree..."
echo ""

# Get root level data (all modules)
"$MVDCT" device "$DEVICE" fetch / --console > "$OUTPUT_FILE" 2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ YANG data retrieved successfully!"
    echo ""
    echo "📊 Output saved to: $OUTPUT_FILE"
    echo "📏 File size: $(du -h "$OUTPUT_FILE" | cut -f1)"
    echo ""
    echo "💡 View the file:"
    echo "   cat $OUTPUT_FILE"
    echo "   less $OUTPUT_FILE"
    echo "   code $OUTPUT_FILE"
else
    echo ""
    echo "❌ Failed to retrieve YANG data!"
    echo "   Check the error messages above."
    exit 1
fi

echo ""
echo "🎉 Done!"
