#!/bin/bash
# CBS 설정 확인 스크립트

MVDCT="/home/kim/Downloads/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12/mvdct"
DEVICE="/dev/ttyACM0"

echo "=== CBS Configuration Check ==="
echo ""

for iface in 8 9 10 11; do
    echo "--- Interface $iface ---"
    "$MVDCT" device "$DEVICE" get \
        "/ietf-interfaces:interfaces/interface[name='$iface']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers" \
        --console 2>/dev/null | grep -A 5 "traffic-class-shapers:" || echo "No CBS configured"
    echo ""
done
